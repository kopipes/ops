/**
 * Report editing after submit (§13.1) and its revision history (§9.5 no.4).
 *
 * Rules enforced here:
 * - Only the author (within the window) or a manager/admin may edit.
 * - The window closes when the day is reviewed, or at H+1 12:00 project time.
 * - EVERY edit writes an immutable `report_revisions` snapshot BEFORE the change,
 *   so "Lihat riwayat" can show the previous version and a per-item diff.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
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
  reportRevisions,
  reports,
  users,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { canEditReport, type ActingUser } from "@/server/permissions";
import { editDeadline } from "@/lib/datetime";
import { ForbiddenError, ValidationError } from "./checklist-items";
import { loadFacts } from "./projects";
import { validateResults, type CheckResultInput } from "./reports";

type DB = BetterSQLite3Database<typeof schema>;

export interface EditableReport {
  id: string;
  phase: "opening" | "monitoring" | "closing";
  submittedAt: number | null;
  notes: string | null;
  latitude: string | null;
  longitude: string | null;
  locationAccuracyM: number | null;
  submittedBy: string;
  submittedByName: string | null;
  results: {
    projectChecklistItemId: string;
    label: string;
    categoryName: string;
    result: "ok" | "not_ok" | "na";
    note: string | null;
    isRequired: boolean;
    requiresPhoto: boolean;
  }[];
  /** §9.5 no.4: true once edited after submit. */
  editCount: number;
  lastEditedByName: string | null;
  lastEditedAt: number | null;
}

export async function getEditableReport(
  db: DB,
  user: ActingUser,
  reportId: string,
): Promise<{ report: EditableReport; canEdit: boolean; editBlockedReason: string | null } | null> {
  const row = await db.select().from(reports).where(eq(reports.id, reportId)).get();
  if (!row || row.deletedAt) return null;

  const day = await db.select().from(projectDays).where(eq(projectDays.id, row.projectDayId)).get();
  const project = await db.select().from(projects).where(eq(projects.id, row.projectId)).get();
  if (!day || !project) return null;

  const facts = await loadFacts(db, row.projectId);

  const results = await db
    .select({
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
    .where(eq(reportCheckResults.reportId, reportId))
    .orderBy(asc(projectChecklistItems.sortOrder));

  const revisions = await db
    .select({ id: reportRevisions.id, editedBy: reportRevisions.editedBy, createdAt: reportRevisions.createdAt })
    .from(reportRevisions)
    .where(eq(reportRevisions.reportId, reportId))
    .orderBy(asc(reportRevisions.createdAt));

  const submitter = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, row.submittedBy))
    .get();

  const lastRevision = revisions[revisions.length - 1];
  const lastEditor = lastRevision?.editedBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, lastRevision.editedBy)).get()
    : null;

  const editable = canEditReport(
    user,
    facts,
    {
      submittedBy: row.submittedBy,
      status: row.status,
      deletedAt: row.deletedAt,
      dayReviewedAt: day.reviewedAt,
      dayDate: day.date,
      timezone: project.timezone,
    },
    Date.now(),
    editDeadline,
  );

  let blockedReason: string | null = null;
  if (!editable) {
    if (day.reviewedAt) blockedReason = "Hari ini sudah direview — laporan tidak bisa diubah (§13.1).";
    else blockedReason = "Batas waktu edit (H+1 12:00) sudah lewat.";
  }

  return {
    report: {
      id: row.id,
      phase: row.phase,
      submittedAt: row.submittedAt,
      notes: row.notes,
      latitude: row.latitude,
      longitude: row.longitude,
      locationAccuracyM: row.locationAccuracyM,
      submittedBy: row.submittedBy,
      submittedByName: submitter?.name ?? null,
      results: results.map((r) => ({
        projectChecklistItemId: r.projectChecklistItemId,
        label: r.label,
        categoryName: r.categoryName,
        result: r.result as "ok" | "not_ok" | "na",
        note: r.note,
        isRequired: r.isRequired,
        requiresPhoto: r.requiresPhoto,
      })),
      editCount: revisions.length,
      lastEditedByName: lastEditor?.name ?? null,
      lastEditedAt: lastRevision?.createdAt ?? null,
    },
    canEdit: editable,
    editBlockedReason: blockedReason,
  };
}

/**
 * Applies an edit. Writes a revision snapshot of the PREVIOUS state first, then
 * updates the report and its results inside one synchronous transaction.
 */
export async function applyReportEdit(
  db: DB,
  raw: Database.Database,
  user: ActingUser,
  reportId: string,
  input: { notes: string | null; results: CheckResultInput[] },
): Promise<void> {
  const loaded = await getEditableReport(db, user, reportId);
  if (!loaded) throw new ValidationError("Laporan tidak ditemukan");
  if (!loaded.canEdit) throw new ForbiddenError(loaded.editBlockedReason ?? "Tidak bisa mengedit");

  /*
   * Validate answers the same way submit does (§4.3 no.3, §8.1) — with one
   * important difference: the edit form does not re-upload photos, so a
   * `requires_photo` item whose photo was attached at submit time must still
   * pass. We therefore treat already-attached photos as satisfying the rule.
   */
  const rows = loaded.report.results.map((r) => ({
    id: r.projectChecklistItemId,
    isRequired: r.isRequired,
    requiresPhoto: r.requiresPhoto,
    label: r.label,
    isActive: true,
  }));

  const resultsWithExistingPhotos = await Promise.all(
    input.results.map(async (r) => {
      if (r.photoIds.length > 0) return r;
      // Count photos already attached to THIS report's check result. Scoping by
      // reportId matters: project checklist items are reused across days, so a
      // lookup on item id alone can return another day's row (and its photos),
      // silently satisfying `requires_photo` for an item that has none here.
      const checkResult = await db
        .select({ id: reportCheckResults.id })
        .from(reportCheckResults)
        .where(
          and(
            eq(reportCheckResults.reportId, reportId),
            eq(reportCheckResults.projectChecklistItemId, r.projectChecklistItemId),
          ),
        )
        .get();
      if (!checkResult) return r;
      const attached = await db
        .select({ id: photos.id })
        .from(photos)
        .where(and(eq(photos.ownerType, "check_result"), eq(photos.ownerId, checkResult.id)));
      return attached.length > 0 ? { ...r, photoIds: attached.map((p) => p.id) } : r;
    }),
  );

  const validation = validateResults(rows, resultsWithExistingPhotos);
  if (!validation.ok) throw new ValidationError(validation.message);

  const now = Date.now();
  const snapshot = {
    notes: loaded.report.notes,
    results: loaded.report.results.map((r) => ({
      projectChecklistItemId: r.projectChecklistItemId,
      label: r.label,
      result: r.result,
      note: r.note,
    })),
  };

  const changes = computeChanges(snapshot.results, input.results);
  if (snapshot.notes === input.notes && changes.length === 0) {
    throw new ValidationError("Tidak ada perubahan");
  }

  const revisionId = randomUUID();

  const tx = raw.transaction(() => {
    raw
      .prepare(
        `insert into report_revisions (id, report_id, edited_by, snapshot_json, changes_json, created_at)
         values (?,?,?,?,?,?)`,
      )
      .run(
        revisionId,
        reportId,
        user.id,
        JSON.stringify(snapshot),
        JSON.stringify(changes),
        now,
      );

    raw.prepare(`update reports set notes = ?, updated_at = ? where id = ?`).run(input.notes, now, reportId);

    const updateResult = raw.prepare(
      `update report_check_results set result = ?, note = ? where report_id = ? and project_checklist_item_id = ?`,
    );
    for (const r of input.results) {
      updateResult.run(r.result, r.note ?? null, reportId, r.projectChecklistItemId);
    }

    raw
      .prepare(
        `insert into audit_logs (id, user_id, action, entity_type, entity_id, meta_json, ip, created_at)
         values (?,?,?,?,?,?,?,?)`,
      )
      .run(
        randomUUID(),
        user.id,
        "report.edited",
        "report",
        reportId,
        JSON.stringify({ revisionId, changedFields: changes.length }),
        null,
        now,
      );
  });

  tx();
}

export interface FieldChange {
  projectChecklistItemId: string;
  label: string;
  field: "result" | "note";
  from: string | null;
  to: string | null;
}

/** Per-item diff between the previous snapshot and the new answers. */
export function computeChanges(
  before: { projectChecklistItemId: string; label: string; result: string; note: string | null }[],
  after: CheckResultInput[],
): FieldChange[] {
  const byId = new Map(before.map((b) => [b.projectChecklistItemId, b]));
  const changes: FieldChange[] = [];

  for (const next of after) {
    const prev = byId.get(next.projectChecklistItemId);
    if (!prev) continue;

    if (prev.result !== next.result) {
      changes.push({
        projectChecklistItemId: next.projectChecklistItemId,
        label: prev.label,
        field: "result",
        from: prev.result,
        to: next.result,
      });
    }
    if ((prev.note ?? "") !== (next.note ?? "")) {
      changes.push({
        projectChecklistItemId: next.projectChecklistItemId,
        label: prev.label,
        field: "note",
        from: prev.note,
        to: next.note,
      });
    }
  }
  return changes;
}

export interface RevisionView {
  id: string;
  editedByName: string | null;
  createdAt: number;
  changes: FieldChange[];
  snapshot: {
    notes: string | null;
    results: { label: string; result: string; note: string | null }[];
  };
}

export async function listReportRevisions(db: DB, reportId: string): Promise<RevisionView[]> {
  const rows = await db
    .select({
      id: reportRevisions.id,
      editedBy: reportRevisions.editedBy,
      createdAt: reportRevisions.createdAt,
      snapshotJson: reportRevisions.snapshotJson,
      changesJson: reportRevisions.changesJson,
    })
    .from(reportRevisions)
    .where(eq(reportRevisions.reportId, reportId))
    .orderBy(asc(reportRevisions.createdAt));

  if (rows.length === 0) return [];

  const editorIds = [...new Set(rows.map((r) => r.editedBy).filter(Boolean))] as string[];
  const editorRows =
    editorIds.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, editorIds));
  const editorName = new Map(editorRows.map((e) => [e.id, e.name]));

  return rows.map((r) => {
    const snap = JSON.parse(r.snapshotJson) as {
      notes: string | null;
      results: { label: string; result: string; note: string | null }[];
    };
    return {
      id: r.id,
      editedByName: r.editedBy ? (editorName.get(r.editedBy) ?? null) : null,
      createdAt: r.createdAt,
      changes: r.changesJson ? (JSON.parse(r.changesJson) as FieldChange[]) : [],
      snapshot: { notes: snap.notes, results: snap.results },
    };
  });
}

/** §9.5 no.4: "Diedit oleh X, jam Y" for the day detail. */
export async function getEditLabel(
  db: DB,
  reportId: string,
): Promise<{ editedByName: string | null; editedAt: number } | null> {
  const rows = await db
    .select({ editedBy: reportRevisions.editedBy, createdAt: reportRevisions.createdAt })
    .from(reportRevisions)
    .where(eq(reportRevisions.reportId, reportId))
    .orderBy(asc(reportRevisions.createdAt));

  const last = rows[rows.length - 1];
  if (!last) return null;

  const editor = last.editedBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, last.editedBy)).get()
    : null;

  return { editedByName: editor?.name ?? null, editedAt: last.createdAt };
}
