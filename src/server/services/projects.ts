/**
 * Project service (§6, §11.3).
 *
 * The `project_days` regeneration rules are the subtlest part of the app: a
 * naive "replace all days" on every save would destroy reports. The rules
 * implemented here (see §11.3):
 *   1. widen the range  -> only INSERT new days (idempotent)
 *   2. shrink the range -> hard DELETE a day only when it has no reports,
 *      issues, photos or review; otherwise keep it and flag is_out_of_range
 *   3. deleting a day that has data is Admin-only (enforced by the caller's
 *      permissions) and audited
 *   4. date edits on completed/archived projects are refused until reopened
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { getGlobalSettings } from "./app-settings";
import { recordTemplateUsage } from "./templates";
import { readProjectTemplate } from "./division-templates";
import type { SnapshotRow } from "./project-checklist";
import {
  auditLogs,
  dayComments,
  issues,
  photos,
  projectDays,
  projectChecklistItems,
  projectDivisions,
  projectMembers,
  projects,
  reports,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { addDays, dateRange } from "@/lib/datetime";
import { deleteProjectSchema, PROJECT_STATUS_FLOW, type ProjectDetailsInput, type ProjectInput } from "@/lib/schemas";
import type { ProjectStatus } from "@/server/db/schema";
import {
  canManageProject,
  canViewProjectWorkspace,
  canDeleteProject,
  isAdmin,
  isManager,
  type ActingUser,
  type ProjectFacts,
} from "@/server/permissions";
import { currentProjectAccess, currentProjectActor } from "./project-access";
import { ForbiddenError, ValidationError } from "./checklist-items";

type DB = BetterSQLite3Database<typeof schema>;

// ---------------------------------------------------------------------------
// Code generation (§6.1 no.1: auto, e.g. EVT-2026-0012, editable)
// ---------------------------------------------------------------------------

/**
 * Generates the next project code for a division prefix and year.
 * Uses the owner division's `code` (EVT/OPS/CRE) per §6.1's example.
 */
export async function generateProjectCode(
  db: DB,
  opts: { divisionCode: string; year: number },
): Promise<string> {
  const prefix = `${opts.divisionCode.toUpperCase()}-${opts.year}-`;
  const rows = await db
    .select({ code: projects.code })
    .from(projects)
    .where(sql`${projects.code} LIKE ${`${prefix}%`}`)
    .orderBy(desc(projects.code));

  let max = 0;
  for (const r of rows) {
    const tail = r.code.slice(prefix.length);
    const n = Number.parseInt(tail, 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// project_days generation (§11.3)
// ---------------------------------------------------------------------------

export interface DaySyncResult {
  inserted: number;
  deleted: number;
  flaggedOutOfRange: number;
  keptWithData: string[];
}

/** Does this day hold anything a user would lose if it were deleted? */
function dayHasData(db: DB, projectDayId: string): boolean {
  const report = db
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.projectDayId, projectDayId))
    .limit(1).all();
  if (report.length > 0) return true;

  const issue = db
    .select({ id: issues.id })
    .from(issues)
    .where(eq(issues.projectDayId, projectDayId))
    .limit(1).all();
  if (issue.length > 0) return true;

  const photo = db
    .select({ id: photos.id })
    .from(photos)
    .where(eq(photos.projectDayId, projectDayId))
    .limit(1).all();
  if (photo.length > 0) return true;

  const comment = db.select({ id: dayComments.id }).from(dayComments)
    .where(eq(dayComments.projectDayId, projectDayId)).get();
  if (comment) return true;

  const day = db
    .select({
      reviewedAt: projectDays.reviewedAt, handoverNote: projectDays.handoverNote,
      assignedUserId: projectDays.assignedUserId, dayType: projectDays.dayType,
    })
    .from(projectDays)
    .where(eq(projectDays.id, projectDayId))
    .get();
  if (day && (day.reviewedAt || day.handoverNote || day.assignedUserId || day.dayType !== "event")) return true;

  return false;
}

/**
 * Reconciles project_days with the project's date range.
 *
 * Deliberately NOT a delete-all-and-recreate: that would cascade-delete reports.
 */
export function syncProjectDays(
  db: DB,
  projectId: string,
  range: { startDate: string; endDate: string },
): DaySyncResult {
  const wanted = dateRange(range.startDate, range.endDate);
  if (wanted.at(-1) !== range.endDate) throw new ValidationError("Rentang tanggal project tidak valid atau terlalu panjang");
  const wantedSet = new Set(wanted);

  const existing = db
    .select({ id: projectDays.id, date: projectDays.date, isOutOfRange: projectDays.isOutOfRange })
    .from(projectDays)
    .where(eq(projectDays.projectId, projectId))
    .orderBy(asc(projectDays.date)).all();

  const existingByDate = new Map(existing.map((d) => [d.date, d]));
  const now = Date.now();
  const result: DaySyncResult = { inserted: 0, deleted: 0, flaggedOutOfRange: 0, keptWithData: [] };

  // 1) insert missing days
  for (const date of wanted) {
    if (existingByDate.has(date)) continue;
    db.insert(projectDays).values({
      id: randomUUID(),
      projectId,
      date,
      dayType: "event",
      isOutOfRange: false,
      createdAt: now,
      updatedAt: now,
    }).run();
    result.inserted += 1;
  }

  // 2) handle days outside the new range
  for (const day of existing) {
    if (wantedSet.has(day.date)) {
      // Back inside the range again: clear a previous flag.
      if (day.isOutOfRange) {
        db
          .update(projectDays)
          .set({ isOutOfRange: false, updatedAt: now })
          .where(eq(projectDays.id, day.id)).run();
      }
      continue;
    }

    if (dayHasData(db, day.id)) {
      db
        .update(projectDays)
        .set({ isOutOfRange: true, updatedAt: now })
        .where(eq(projectDays.id, day.id)).run();
      result.flaggedOutOfRange += 1;
      result.keptWithData.push(day.date);
    } else {
      db.delete(projectDays).where(eq(projectDays.id, day.id)).run();
      result.deleted += 1;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Create / update
// ---------------------------------------------------------------------------

function assertCanCreate(user: ActingUser): void {
  if (!user.isActive) throw new ForbiddenError();
  // §2.3: buat/edit project — admin, manager (divisinya).
  if (!isAdmin(user) && !isManager(user)) throw new ForbiddenError();
}

export interface CreateProjectResult {
  projectId: string;
  days: DaySyncResult;
}

interface InitialProjectChecklist {
  templateVersion: number;
  removedTemplateRows: string[];
  copiedRows: Omit<SnapshotRow, "id" | "projectId">[];
}

export async function createProject(
  db: DB,
  actor: ActingUser,
  input: ProjectInput,
  initialChecklist?: InitialProjectChecklist,
): Promise<CreateProjectResult> {
  return db.transaction((tx) => {
    const user = currentProjectActor(tx, actor);
    assertCanCreate(user);
    if (!isAdmin(user) && !user.divisionIds.includes(input.ownerDivisionId)) {
      throw new ForbiddenError("Kamu hanya bisa membuat project untuk divisimu");
    }
    if (!input.code && getGlobalSettings(tx).projectCodeRequired) {
      throw new ValidationError("Nomor project wajib diisi.");
    }
    assertProjectCodeAvailable(tx, input.code);

    const templateIds = input.checklistSource === "template" ? input.templateIds : [];
    if (input.checklistSource === "template" && templateIds.length !== 1) {
      throw new ValidationError("Pilih satu template divisi.");
    }
    if (input.checklistSource === "project" && (!initialChecklist || !input.sourceProjectId)) {
      throw new ValidationError("Pilih project sumber.");
    }
    const template = templateIds[0]
      ? readProjectTemplate(tx, user, templateIds[0], input.ownerDivisionId)
      : null;
    if (template && template.version !== initialChecklist?.templateVersion) {
      throw new ValidationError("Template berubah. Pilih kembali template untuk melihat isi terbaru.");
    }
    if (initialChecklist && input.checklistSource === "project" && input.sourceProjectId) {
      const source = currentProjectAccess(tx, user, input.sourceProjectId);
      if (!canViewProjectWorkspace(source.user, source.facts)) throw new ForbiddenError("Project sumber tidak tersedia dalam aksesmu");
    }
    const removed = new Set(initialChecklist?.removedTemplateRows);
    const rows = [
      ...(template?.rows.filter((row) => !removed.has(row.id)).map((row) => ({ ...row, sourceItemId: null })) ?? []),
      ...(initialChecklist?.copiedRows ?? []),
      ...input.checklistItems.map((row) => ({ ...row, sourceItemId: null })),
    ];
    if (rows.length > 1000) throw new ValidationError("Maksimal 1.000 poin checklist per project.");

    const id = randomUUID();
    const now = Date.now();

    tx.insert(projects).values({
      id,
      code: input.code.toUpperCase(),
      name: input.name,
      client: input.client ?? null,
      venue: input.venue,
      address: input.address ?? null,
      description: input.description ?? null,
      startDate: input.startDate,
      endDate: input.endDate,
      timezone: input.timezone,
      ownerDivisionId: input.ownerDivisionId,
      status: input.saveAsDraft ? "draft" : "active",
      openingWindowStart: input.openingWindowStart,
      openingWindowEnd: input.openingWindowEnd,
      closingWindowStart: input.closingWindowStart,
      closingWindowEnd: input.closingWindowEnd,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    }).run();

    for (const [sortOrder, row] of rows.entries()) {
      tx.insert(projectChecklistItems).values({
        id: randomUUID(), projectId: id, sourceItemId: row.sourceItemId,
        phase: row.phase, categoryName: row.categoryName, label: row.label, description: row.description,
        isRequired: row.isRequired, requiresPhoto: row.requiresPhoto, sortOrder, isActive: true,
        createdAt: now, updatedAt: now,
      }).run();
    }

    for (const divisionId of new Set(input.additionalDivisionIds)) {
      tx.insert(projectDivisions).values({ projectId: id, divisionId }).onConflictDoNothing().run();
    }

    const members = input.members.filter((member) => member.userId !== user.id);
    for (const m of members) {
      tx
        .insert(projectMembers)
        .values({
          projectId: id,
          userId: m.userId,
          roleInProject: m.roleInProject,
          isActive: true,
          addedBy: user.id,
          createdAt: now,
        })
        .onConflictDoUpdate({
          target: [projectMembers.projectId, projectMembers.userId],
          set: { roleInProject: m.roleInProject, isActive: true },
        }).run();
    }

    const days = syncProjectDays(tx, id, {
      startDate: input.startDate,
      endDate: input.endDate,
    });

    audit(tx, user, "project.created", id, {
      code: input.code,
      status: input.saveAsDraft ? "draft" : "active",
      members: members.length,
      days: days.inserted,
    });

    if (input.checklistSource === "template") {
      recordTemplateUsage(tx, user, id, input.templateIds);
    }

    return { projectId: id, days };
  }, { behavior: "immediate" });
}

function assertProjectCodeAvailable(db: DB, code: string, excludeProjectId?: string) {
  if (!code) return;
  const existing = db.select({ id: projects.id }).from(projects).where(and(
    eq(projects.code, code.toUpperCase()), isNull(projects.deletedAt),
    excludeProjectId ? ne(projects.id, excludeProjectId) : undefined,
  )).get();
  if (existing) throw new ValidationError(`Kode project "${code}" sudah dipakai`);
}

export interface UpdateProjectResult {
  days: DaySyncResult;
  datesChanged: boolean;
}

export async function updateProject(
  db: DB,
  actor: ActingUser,
  projectId: string,
  input: ProjectDetailsInput,
  expectedUpdatedAt?: number,
): Promise<UpdateProjectResult> {
  return db.transaction((tx) => {
    const { user } = requireProjectManagement(tx, actor, projectId);
    const current = tx.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!current) throw new ValidationError("Project tidak ditemukan");
    if (expectedUpdatedAt !== undefined && expectedUpdatedAt !== current.updatedAt) {
      throw new ValidationError("Detail project sudah berubah. Muat ulang sebelum menyimpan.");
    }

    // §11.3 rule 4: date edits on completed/archived projects are refused.
    const datesChanged =
      current.startDate !== input.startDate || current.endDate !== input.endDate;
    if (datesChanged && (current.status === "completed" || current.status === "archived")) {
      throw new ValidationError(
        "Tanggal tidak bisa diubah saat project selesai/arsip. Buka kembali (reopen) project terlebih dahulu.",
      );
    }

    // The project Owner and the organizational division are separate. Only Admin can change the division.
    if (current.ownerDivisionId !== input.ownerDivisionId && !isAdmin(user)) {
      throw new ForbiddenError("Hanya Admin yang bisa mengubah divisi owner");
    }

    assertProjectCodeAvailable(tx, input.code, projectId);

    tx
      .update(projects)
      .set({
        code: input.code.toUpperCase(),
        name: input.name,
        client: input.client ?? null,
        venue: input.venue,
        address: input.address ?? null,
        description: input.description ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        ownerDivisionId: input.ownerDivisionId,
        updatedAt: Math.max(Date.now(), current.updatedAt + 1),
      })
      .where(eq(projects.id, projectId)).run();

    // Replace additional divisions.
    tx.delete(projectDivisions).where(eq(projectDivisions.projectId, projectId)).run();
    for (const divisionId of new Set(input.additionalDivisionIds)) {
      tx.insert(projectDivisions).values({ projectId, divisionId }).onConflictDoNothing().run();
    }

    let days: DaySyncResult = { inserted: 0, deleted: 0, flaggedOutOfRange: 0, keptWithData: [] };
    if (datesChanged) {
      // §11.3 rule 3: deleting a day WITH data requires admin.
      days = syncProjectDaysIfAllowed(tx, user, projectId, input);
    }

    audit(tx, user, "project.updated", projectId, {
      datesChanged,
      ...(current.code !== input.code.toUpperCase() ? { previousCode: current.code, code: input.code.toUpperCase() } : {}),
      ...(datesChanged ? days : {}),
    });

    return { days, datesChanged };
  }, { behavior: "immediate" });
}

/**
 * Wraps syncProjectDays so a non-admin cannot trigger deletion of a day that
 * holds data. Because sync deletes only empty days, the admin check applies to
 * the *intent* of shrinking a range that contains data — we simply flag rather
 * than delete for non-admins.
 */
function syncProjectDaysIfAllowed(
  db: DB,
  user: ActingUser,
  projectId: string,
  input: ProjectDetailsInput,
): DaySyncResult {
  const result = syncProjectDays(db, projectId, {
    startDate: input.startDate,
    endDate: input.endDate,
  });

  if (!isAdmin(user) && result.flaggedOutOfRange > 0) {
    audit(db, user, "project.days_out_of_range", projectId, {
      days: result.keptWithData,
      note: "hari di luar rentang dipertahankan karena sudah punya data",
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Status transitions (§6.2)
// ---------------------------------------------------------------------------

export async function setProjectStatus(
  db: DB,
  actor: ActingUser,
  projectId: string,
  status: ProjectStatus,
  reason?: string,
): Promise<void> {
  db.transaction((tx) => {
    const { user, facts } = requireProjectManagement(tx, actor, projectId);
    if (facts.status === status) return;

    const allowed = PROJECT_STATUS_FLOW[facts.status] as readonly string[];
    if (!allowed.includes(status)) {
      throw new ValidationError(`Tidak bisa mengubah status dari ${facts.status} ke ${status}`);
    }

    // §6.2: reopening (back to an editable state) needs a recorded reason.
    // Moving forward to `archived` is not a reopen, so it needs none.
    const reopening =
      (facts.status === "completed" && status === "active") ||
      (facts.status === "archived" && status !== "archived");
    if (reopening && !reason) {
      throw new ValidationError("Alasan wajib diisi saat membuka kembali project");
    }

    tx
      .update(projects)
      .set({ status, updatedAt: Date.now() })
      .where(eq(projects.id, projectId)).run();

    audit(tx, user, "project.status_changed", projectId, {
      from: facts.status,
      to: status,
      reason: reason ?? null,
    });
  }, { behavior: "immediate" });
}

function requireProjectManagement(db: DB, actor: ActingUser, projectId: string) {
  const access = currentProjectAccess(db, actor, projectId);
  if (!canManageProject(access.user, access.facts)) throw new ForbiddenError();
  return access;
}

export function updateProjectDay(
  db: DB,
  actor: ActingUser,
  projectDayId: string,
  change: { assignedUserId: string | null } | { dayType: typeof projectDays.$inferSelect.dayType },
): string {
  return db.transaction((tx) => {
    const day = tx.select().from(projectDays).where(eq(projectDays.id, projectDayId)).get();
    if (!day) throw new ValidationError("Hari project tidak ditemukan");
    const { user, facts } = requireProjectManagement(tx, actor, day.projectId);

    if ("assignedUserId" in change && change.assignedUserId &&
        (!facts.memberIds.includes(change.assignedUserId) || facts.adminProjectIds.includes(change.assignedUserId))) {
      throw new ValidationError("Petugas harus Crew atau Head Crew project");
    }
    tx.update(projectDays).set({ ...change, updatedAt: Date.now() }).where(eq(projectDays.id, day.id)).run();
    audit(tx, user, "project.day_updated", day.projectId, { date: day.date, ...change });
    return day.projectId;
  }, { behavior: "immediate" });
}

/**
 * §6.2: a project auto-completes at H+1 after its end date.
 * "H+1" means the project's local date is strictly after its end date.
 * Called by a scheduler; returns the ids it transitioned.
 */
export async function autoCompleteExpiredProjects(
  db: DB,
  now: number,
  todayInZone: (timezone: string) => string,
): Promise<string[]> {
  const candidates = await db
    .select({ id: projects.id, endDate: projects.endDate, timezone: projects.timezone })
    .from(projects)
    .where(and(eq(projects.status, "active"), isNull(projects.deletedAt)));

  const done: string[] = [];
  for (const p of candidates) {
    const today = todayInZone(p.timezone);
    // Only complete once the day AFTER the end date has started.
    if (today > p.endDate) {
      await db
        .update(projects)
        .set({ status: "completed", updatedAt: now })
        .where(eq(projects.id, p.id));
      done.push(p.id);
    }
  }
  return done;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Keep historical rows/files, and record the removal atomically with its audit. */
export async function softDeleteProject(
  db: DB,
  user: ActingUser,
  projectId: string,
  reason: string,
  confirmationCode: string,
): Promise<void> {
  if (!canDeleteProject(user)) throw new ForbiddenError("Hanya Admin yang bisa menghapus project");
  const parsed = deleteProjectSchema.safeParse({ projectId, reason, confirmationCode });
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Input tidak valid");

  db.transaction(tx => {
    const current = tx.select().from(projects)
      .where(and(eq(projects.id, parsed.data.projectId), isNull(projects.deletedAt))).get();
    if (!current) throw new ValidationError("Project tidak ditemukan atau sudah dihapus");
    const access = currentProjectAccess(tx, user, current.id);
    if (!canDeleteProject(access.user)) throw new ForbiddenError("Hanya Admin yang bisa menghapus project");
    if (parsed.data.confirmationCode !== (current.code || current.name)) {
      throw new ValidationError(current.code
        ? "Kode konfirmasi tidak sesuai dengan kode project"
        : "Nama konfirmasi tidak sesuai dengan nama project");
    }
    const now = Date.now();
    tx.update(projects).set({ deletedAt: now, updatedAt: now }).where(eq(projects.id, current.id)).run();
    tx.insert(auditLogs).values({
      id: randomUUID(), userId: user.id, action: "project.soft_deleted", entityType: "project",
      entityId: current.id, metaJson: JSON.stringify({ code: current.code, name: current.name, reason: parsed.data.reason }),
      ip: null, createdAt: now,
    }).run();
  }, { behavior: "immediate" });
}

export async function loadFacts(db: DB, projectId: string): Promise<ProjectFacts> {
  const p = await db
    .select({ id: projects.id, status: projects.status, ownerDivisionId: projects.ownerDivisionId, ownerUserId: projects.createdBy })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .get();
  if (!p) throw new ValidationError("Project tidak ditemukan");

  const [divs, memberRows] = await Promise.all([
    db
      .select({ divisionId: projectDivisions.divisionId })
      .from(projectDivisions)
      .where(eq(projectDivisions.projectId, projectId)),
    db
      .select({ userId: projectMembers.userId, role: projectMembers.roleInProject })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.isActive, true))),
  ]);

  const members = memberRows.filter((member) => member.userId !== p.ownerUserId);
  return {
    id: p.id,
    status: p.status,
    ownerDivisionId: p.ownerDivisionId,
    ownerUserId: p.ownerUserId,
    divisionIds: divs.map((d) => d.divisionId),
    memberIds: members.map((m) => m.userId),
    leadIds: members.filter((m) => m.role === "lead").map((m) => m.userId),
    adminProjectIds: members.filter((m) => m.role === "admin_project").map((m) => m.userId),
  };
}

export async function listProjectDays(db: DB, projectId: string) {
  return db
    .select()
    .from(projectDays)
    .where(eq(projectDays.projectId, projectId))
    .orderBy(asc(projectDays.date));
}

/** Days inside the range plus any flagged out-of-range days that hold data. */
export async function listActiveProjectDays(db: DB, projectId: string) {
  const rows = await listProjectDays(db, projectId);
  return rows;
}

function audit(
  db: DB,
  user: ActingUser,
  action: string,
  entityId: string,
  meta: Record<string, unknown>,
) {
  db.insert(auditLogs).values({
    id: randomUUID(),
    userId: user.id,
    action,
    entityType: "project",
    entityId,
    metaJson: JSON.stringify(meta),
    ip: null,
    createdAt: Date.now(),
  }).run();
}
