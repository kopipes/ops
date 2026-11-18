/**
 * Report service — drafts and submission (§4.3, §4.4, §4.5, §9.2).
 *
 * Atomicity: §16.5 requires a submit (report + check results + photo links) to be
 * one transaction. `better-sqlite3` transactions are SYNCHRONOUS — an `async`
 * callback would silently commit outside the transaction — so this module does
 * its multi-statement writes through `raw.transaction(...)` with no `await`
 * inside the transactional body. All validation happens before the transaction.
 */
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  auditLogs,
  photos,
  projectChecklistItems,
  projectDays,
  projects,
  reportCheckResults,
  reports,
  users,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { computeIsLate, toLocalDate, zonedToUtc } from "@/lib/datetime";
import {
  canSubmitPhase,
  isReportEditable,
  type ActingUser,
  type ProjectFacts,
} from "@/server/permissions";
import { editDeadline } from "@/lib/datetime";
import { ForbiddenError, ValidationError } from "./checklist-items";
import { loadFacts } from "./projects";
import { getGlobalSettings, isWindowEnabled, type GlobalSettings } from "./app-settings";

import {currentProjectAccess} from "./project-access";

type DB = BetterSQLite3Database<typeof schema>;

export type Phase = "opening" | "monitoring" | "closing";
export type CheckResult = "ok" | "not_ok" | "na";

export interface CheckResultInput {
  projectChecklistItemId: string;
  result: CheckResult;
  note: string | null;
  photoIds: string[];
}

export interface SubmitInput {
  projectId: string;
  projectDayId: string;
  phase: Phase;
  clientSubmissionId: string;
  notes: string | null;
  /**
   * Narrative shown after the checklist for opening/closing
   * ("Laporan Awal Hari" / "Laporan Akhir Hari").
   */
  phaseNote?: string | null;
  /** Reported time (monitoring). Defaults to now. */
  observedAt: number;
  results: CheckResultInput[];
  /** Report-level photos (not attached to a specific item). */
  photoIds: string[];
  handoverNote?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  locationAccuracyM?: number | null;
  deviceTimeOffsetMs?: number | null;
}

export type SubmitOutcome =
  | { ok: true; reportId: string; isLate: boolean; idempotent: boolean }
  | { ok: false; reason: "forbidden" | "validation"; message: string };

/**
 * Validates the checklist answers before anything is written.
 * §4.3 no.3: a NOT_OK item requires a note; a `requires_photo` item requires a photo.
 */
export function validateResults(
  rows: {
    id: string;
    isRequired: boolean;
    requiresPhoto: boolean;
    label: string;
    isActive: boolean;
  }[],
  results: CheckResultInput[],
): { ok: true } | { ok: false; message: string } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const answered = new Map(results.map((r) => [r.projectChecklistItemId, r]));

  for (const id of answered.keys()) {
    if (!byId.has(id)) {
      return { ok: false, message: "Ada item checklist yang bukan milik project ini" };
    }
  }

  for (const row of rows) {
    if (!row.isActive) continue;
    const answer = answered.get(row.id);

    if (!answer) {
      if (row.isRequired) return { ok: false, message: `Item wajib belum diisi: ${row.label}` };
      continue;
    }

    // §4.3: "Tidak OK" requires a short note.
    if (answer.result === "not_ok" && !answer.note?.trim()) {
      return { ok: false, message: `Catatan wajib diisi untuk item "Tidak OK": ${row.label}` };
    }

    // §8.1: a requires_photo item needs at least one photo.
    if (row.requiresPhoto && answer.photoIds.length === 0) {
      return { ok: false, message: `Foto wajib untuk item: ${row.label}` };
    }
  }

  return { ok: true };
}

/** Which window end applies to a phase (§13.2). */
export function windowEndFor(phase: Phase, p: { openingWindowEnd: string; closingWindowEnd: string }) {
  return phase === "opening" ? p.openingWindowEnd : p.closingWindowEnd;
}

/**
 * Reads the state needed to compute late-ness and permissions. Kept separate
 * from the write path so the sync transaction stays free of async work.
 */
export async function loadSubmitContext(db: DB, input: SubmitInput) {
  const project = await db.select().from(projects).where(eq(projects.id, input.projectId)).get();
  if (!project || project.deletedAt !== null) throw new ValidationError("Project tidak ditemukan");

  const day = await db.select().from(projectDays).where(eq(projectDays.id, input.projectDayId)).get();
  if (!day || day.projectId !== input.projectId) {
    throw new ValidationError("Hari project tidak ditemukan");
  }

  const facts = await loadFacts(db, input.projectId);

  const checklist = await db
    .select({
      id: projectChecklistItems.id,
      isRequired: projectChecklistItems.isRequired,
      requiresPhoto: projectChecklistItems.requiresPhoto,
      label: projectChecklistItems.label,
      isActive: projectChecklistItems.isActive,
      phase: projectChecklistItems.phase,
    })
    .from(projectChecklistItems)
    .where(
      and(
        eq(projectChecklistItems.projectId, input.projectId),
        eq(projectChecklistItems.phase, input.phase),
      ),
    )
    .orderBy(asc(projectChecklistItems.sortOrder));

  return { project, day, facts, checklist };
}

/**
 * Submits a report atomically.
 *
 * A unique client_submission_id protects double-tap/retries. Independent reports
 * are allowed in every phase, including reviewed days.
 */
export async function submitReport(
  db: DB,
  raw: Database.Database,
  user: ActingUser,
  input: SubmitInput,
): Promise<SubmitOutcome> {
  // --- idempotency first: a retry must return success, not an error ---
  const prior = await db
    .select({ id: reports.id, isLate: reports.isLate, submittedBy:reports.submittedBy, projectDayId:reports.projectDayId, projectId:reports.projectId, phase:reports.phase })
    .from(reports)
    .where(eq(reports.clientSubmissionId, input.clientSubmissionId))
    .get();
  if (prior) {
    if(!user.isActive || prior.submittedBy!==user.id || prior.projectId!==input.projectId || prior.projectDayId!==input.projectDayId || prior.phase!==input.phase)return {ok:false,reason:"forbidden",message:"Kunci pengiriman tidak sesuai dengan laporan ini"};
    return { ok: true, reportId: prior.id, isLate: Boolean(prior.isLate), idempotent: true };
  }

  const ctx = await loadSubmitContext(db, input);

  // §2.2 / §4.6 permission for this phase.
  if (!canSubmitPhase(user, ctx.facts, input.phase, ctx.day.assignedUserId)) {
    return {
      ok: false,
      reason: "forbidden",
      message:
        input.phase === "monitoring"
          ? "Kamu bukan member project ini"
          : "Hanya Head Crew, petugas hari ini, Manager, atau Admin yang bisa mengisi opening/closing",
    };
  }



  if(!Number.isFinite(input.observedAt)||input.observedAt<=0||toLocalDate(input.observedAt,ctx.project.timezone)!==ctx.day.date)return {ok:false,reason:"validation",message:"Waktu kejadian harus berada pada tanggal laporan"};
  const photoIds=[...input.photoIds,...input.results.flatMap(r=>r.photoIds)];
  if(new Set(photoIds).size!==photoIds.length)return {ok:false,reason:"validation",message:"Satu foto tidak boleh dipakai pada beberapa lampiran sekaligus"};
  for(const id of photoIds) {
    const photo=raw.prepare("select id from photos where id=? and uploaded_by=? and owner_type='report' and owner_id=? and project_id=? and project_day_id=? and deleted_at is null").get(id,user.id,user.id,input.projectId,input.projectDayId);
    if(!photo)return {ok:false,reason:"validation",message:"Foto tidak tersedia untuk laporan ini. Unggah foto baru pada laporan yang benar."};
  }

  const validation = validateResults(ctx.checklist, input.results);
  if (!validation.ok) {
    return { ok: false, reason: "validation", message: validation.message };
  }

  const now = Date.now();
  const submittedAt = now;

  // §13.2: is_late is computed ONCE, here, against the window in force now.
  let isLate = false;
  const settings = await getGlobalSettings(db);
  if (isWindowEnabled(input.phase, settings)) {
    const windowEnd = windowEndFor(input.phase, ctx.project);
    isLate = computeIsLate(
      submittedAt,
      ctx.day.date,
      windowEnd,
      ctx.project.timezone,
    );
  }

  // Device-vs-server offset (§9.5 #9): informational only.
  const deviceOffset =
    input.deviceTimeOffsetMs ??
    (input.observedAt ? Math.round(input.observedAt - submittedAt) : null);

  const reportId = randomUUID();
  const resultIds: { id: string; projectChecklistItemId: string }[] = [];

  // ---------------------------------------------------------------------
  // SYNCHRONOUS transaction — no await between BEGIN and COMMIT.
  // ---------------------------------------------------------------------
  const tx = raw.transaction(() => {
    const freshDay=raw.prepare('select reviewed_at from project_days where id=?').get(input.projectDayId) as {reviewed_at:number|null}|undefined;
    if(!freshDay) throw new ForbiddenError("Hari tidak ditemukan");
    const current=currentProjectAccess(db,user,input.projectId);
    const assignment=raw.prepare("select assigned_user_id from project_days where id=?").get(input.projectDayId) as {assigned_user_id:string|null};
    if(!canSubmitPhase(current.user,current.facts,input.phase,assignment.assigned_user_id))throw new ForbiddenError("Akses project sudah berubah");
    raw
      .prepare(
        `insert into reports (id, project_id, project_day_id, phase, submitted_by,
           client_submission_id, status, notes, phase_note, handover_note, observed_at, submitted_at, is_late,
           device_time_offset_ms, latitude, longitude, location_accuracy_m,
           created_at, updated_at)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        reportId,
        input.projectId,
        input.projectDayId,
        input.phase,
        user.id,
        input.clientSubmissionId,
        "submitted",
        input.notes ?? null,
        input.phaseNote ?? null,
        input.phase === "closing" ? input.handoverNote ?? null : null,
        input.observedAt,
        submittedAt,
        isLate ? 1 : 0,
        deviceOffset,
        input.latitude ?? null,
        input.longitude ?? null,
        input.locationAccuracyM ?? null,
        now,
        Math.max(now,(freshDay.reviewed_at??0)+1),
      );

    const insertResult = raw.prepare(
      `insert into report_check_results (id, report_id, project_checklist_item_id, result, note, created_at)
       values (?,?,?,?,?,?)`,
    );

    for (const r of input.results) {
      const rid = randomUUID();
      resultIds.push({ id: rid, projectChecklistItemId: r.projectChecklistItemId });
      insertResult.run(rid, reportId, r.projectChecklistItemId, r.result, r.note ?? null, now);

      // Link per-item photos to the check result.
      for (const photoId of r.photoIds) {
        const claimed=raw.prepare("update photos set owner_type='check_result',owner_id=? where id=? and owner_type='report' and owner_id=? and uploaded_by=? and project_id=? and project_day_id=? and deleted_at is null").run(rid,photoId,user.id,user.id,input.projectId,input.projectDayId);
        if(claimed.changes!==1)throw new ValidationError("Foto sudah dipakai atau berubah. Unggah ulang foto.");
      }
    }

    // Report-level photos.
    for (const photoId of input.photoIds) {
      const claimed=raw.prepare("update photos set owner_type='report',owner_id=? where id=? and owner_type='report' and owner_id=? and uploaded_by=? and project_id=? and project_day_id=? and deleted_at is null").run(reportId,photoId,user.id,user.id,input.projectId,input.projectDayId);
      if(claimed.changes!==1)throw new ValidationError("Foto sudah dipakai atau berubah. Unggah ulang foto.");
    }

    // §4.5: closing carries a handover note for tomorrow's opening.
    if (input.phase === "closing" && input.handoverNote !== undefined) {
      const latest=raw.prepare("select id from reports where project_day_id=? and phase='closing' and status='submitted' and deleted_at is null order by observed_at desc,submitted_at desc,id desc limit 1").get(input.projectDayId) as {id:string}|undefined;
      if(latest?.id===reportId)raw.prepare(`update project_days set handover_note = ?, updated_at = ? where id = ?`).run(input.handoverNote??null,now,input.projectDayId);
    }

    raw
      .prepare(
        `insert into audit_logs (id, user_id, action, entity_type, entity_id, meta_json, ip, created_at)
         values (?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        user.id,
        "report.submitted",
        "report",
        reportId,
        JSON.stringify({ phase: input.phase, isLate, results: input.results.length }),
        null,
        now,
      );
  });

  try {
    tx();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The DB-level guard fired — translate it into a friendly message.
    if (msg.includes("UNIQUE") && msg.includes("client_submission")) {
      // Lost a race with an identical retry: treat as success.
      const again = await db
        .select({ id: reports.id, isLate: reports.isLate, submittedBy:reports.submittedBy, projectId:reports.projectId, projectDayId:reports.projectDayId, phase:reports.phase })
        .from(reports)
        .where(eq(reports.clientSubmissionId, input.clientSubmissionId))
        .get();
      if (again && again.submittedBy===user.id && again.projectId===input.projectId && again.projectDayId===input.projectDayId && again.phase===input.phase) {
        return { ok: true, reportId: again.id, isLate: Boolean(again.isLate), idempotent: true };
      }
    }
    throw err;
  }

  return { ok: true, reportId, isLate, idempotent: false };
}

// ---------------------------------------------------------------------------
// Drafts (§4.3 no.8 — local drafts also live in IndexedDB; this is the server copy)
// ---------------------------------------------------------------------------

export async function saveDraft(
  db: DB,
  user: ActingUser,
  input: Omit<SubmitInput, "clientSubmissionId"> & { clientSubmissionId: string },
): Promise<{ reportId: string }> {
  const ctx = await loadSubmitContext(db, input as SubmitInput);

  if (!canSubmitPhase(user, ctx.facts, input.phase, ctx.day.assignedUserId)) {
    throw new ForbiddenError();
  }

  const existing = await db
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.clientSubmissionId, input.clientSubmissionId))
    .get();

  const now = Date.now();
  const reportId = existing?.id ?? randomUUID();

  if (existing) {
    await db
      .update(reports)
      .set({
        notes: input.notes ?? null,
        phaseNote: input.phaseNote ?? null,
        observedAt: input.observedAt,
        updatedAt: now,
      })
      .where(eq(reports.id, reportId));
  } else {
    await db.insert(reports).values({
      id: reportId,
      projectId: input.projectId,
      projectDayId: input.projectDayId,
      phase: input.phase,
      submittedBy: user.id,
      clientSubmissionId: input.clientSubmissionId,
      status: "draft",
      notes: input.notes ?? null,
      phaseNote: input.phaseNote ?? null,
      observedAt: input.observedAt,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      locationAccuracyM: input.locationAccuracyM ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Draft check results are stored so a reopened draft shows previous answers.
  await db.delete(reportCheckResults).where(eq(reportCheckResults.reportId, reportId));
  if (input.results.length > 0) {
    await db.insert(reportCheckResults).values(
      input.results.map((r) => ({
        id: randomUUID(),
        reportId,
        projectChecklistItemId: r.projectChecklistItemId,
        result: r.result,
        note: r.note ?? null,
        createdAt: now,
      })),
    );
  }

  return { reportId };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface DayReportSummary {
  reportId: string;
  phase: Phase;
  status: "draft" | "submitted";
  submittedAt: number | null;
  isLate: boolean;
  submittedByName: string | null;
  notes: string | null;
  phaseNote: string | null;
  handoverNote: string | null;
  latitude: string | null;
  longitude: string | null;
  locationAccuracyM: number | null;
  results: {
    id: string;
    projectChecklistItemId: string;
    label: string;
    categoryName: string;
    result: CheckResult;
    note: string | null;
    isRequired: boolean;
    requiresPhoto: boolean;
  }[];
}

/** Everything the day page needs for one phase. */
export async function getReportForDayPhase(
  db: DB,
  projectDayId: string,
  phase: Phase,
): Promise<DayReportSummary | null> {
  const report = await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.projectDayId, projectDayId),
        eq(reports.phase, phase),
        isNull(reports.deletedAt),
        eq(reports.status, "submitted"),
      ),
    )
    .orderBy(phase === "opening" ? asc(reports.observedAt) : desc(reports.observedAt), phase === "opening" ? asc(reports.submittedAt) : desc(reports.submittedAt), phase === "opening" ? asc(reports.id) : desc(reports.id))
    .get();

  if (!report) return null;

  const results = await db
    .select({
      id: reportCheckResults.id,
      projectChecklistItemId: reportCheckResults.projectChecklistItemId,
      result: reportCheckResults.result,
      note: reportCheckResults.note,
      label: projectChecklistItems.label,
      categoryName: projectChecklistItems.categoryName,
      isRequired: projectChecklistItems.isRequired,
      requiresPhoto: projectChecklistItems.requiresPhoto,
      sortOrder: projectChecklistItems.sortOrder,
    })
    .from(reportCheckResults)
    .innerJoin(
      projectChecklistItems,
      eq(projectChecklistItems.id, reportCheckResults.projectChecklistItemId),
    )
    .where(eq(reportCheckResults.reportId, report.id))
    .orderBy(asc(projectChecklistItems.sortOrder));

  const day = await db
    .select({ handoverNote: projectDays.handoverNote })
    .from(projectDays)
    .where(eq(projectDays.id, projectDayId))
    .get();

  const submitter = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, report.submittedBy))
    .get();

  return {
    reportId: report.id,
    phase: report.phase,
    status: report.status,
    submittedAt: report.submittedAt,
    isLate: Boolean(report.isLate),
    submittedByName: submitter?.name ?? null,
    notes: report.notes,
    phaseNote: report.phaseNote,
    handoverNote: report.handoverNote,
    latitude: report.latitude,
    longitude: report.longitude,
    locationAccuracyM: report.locationAccuracyM,
    results,
  };
}

/** Monitoring entries for a day, newest first (§4.4). */
export async function listMonitoringReports(db: DB, projectDayId: string) {
  return db
    .select({
      id: reports.id,
      submittedAt: reports.submittedAt,
      observedAt: reports.observedAt,
      notes: reports.notes,
      submittedBy: reports.submittedBy,
    })
    .from(reports)
    .where(
      and(
        eq(reports.projectDayId, projectDayId),
        eq(reports.phase, "monitoring"),
        isNull(reports.deletedAt),
        eq(reports.status, "submitted"),
      ),
    )
    .orderBy(asc(reports.submittedAt));
}

/**
 * §4.2: is the opening window already past with nothing submitted?
 */
export function isPhaseOverdue(
  phase: Phase,
  dayDate: string,
  project: { openingWindowEnd: string; closingWindowEnd: string; timezone: string },
  now: number,
  windows: Pick<GlobalSettings, "openingWindowEnabled" | "closingWindowEnabled"> = { openingWindowEnabled: true, closingWindowEnabled: true },
): boolean {
  if (!isWindowEnabled(phase, windows)) return false;
  const end = zonedToUtc(dayDate, windowEndFor(phase, project), project.timezone);
  return now > end;
}

/** §13.1 helper: can this user still edit the day's report? */
export function canEditDayReport(
  user: ActingUser,
  facts: ProjectFacts,
  factsInput: {
    submittedBy: string;
    dayReviewedAt: number | null;
    dayDate: string;
    timezone: string;
  },
  now: number,
): boolean {
  if (user.role === "admin") return true;
  if (
    user.role === "manager" &&
    (user.divisionIds.includes(facts.ownerDivisionId) ||
      facts.divisionIds.some((d) => user.divisionIds.includes(d)))
  ) {
    return true;
  }
  if (factsInput.submittedBy !== user.id) return false;
  return isReportEditable(
    now,
    { ...factsInput, status: "submitted", deletedAt: null },
    editDeadline,
  );
}

/** All submitted reports in a phase, ordered by event time then server timestamp. */
export async function listPhaseReports(db: DB, projectDayId: string, phase: Phase) {
  return db.select({ id:reports.id,submittedAt:reports.submittedAt,observedAt:reports.observedAt,notes:reports.notes,phaseNote:reports.phaseNote,submittedByName:users.name })
    .from(reports).leftJoin(users,eq(users.id,reports.submittedBy))
    .where(and(eq(reports.projectDayId,projectDayId),eq(reports.phase,phase),isNull(reports.deletedAt),eq(reports.status,"submitted")))
    .orderBy(asc(reports.observedAt),asc(reports.submittedAt),asc(reports.id));
}
