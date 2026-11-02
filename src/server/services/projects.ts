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
import {
  auditLogs,
  issues,
  photos,
  projectDays,
  projectDivisions,
  projectMembers,
  projects,
  reports,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { addDays, dateRange } from "@/lib/datetime";
import { PROJECT_STATUS_FLOW, type ProjectInput } from "@/lib/schemas";
import type { ProjectStatus } from "@/server/db/schema";
import {
  canManageProject,
  isAdmin,
  isManager,
  type ActingUser,
  type ProjectFacts,
} from "@/server/permissions";
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
export async function dayHasData(db: DB, projectDayId: string): Promise<boolean> {
  const report = await db
    .select({ id: reports.id })
    .from(reports)
    .where(eq(reports.projectDayId, projectDayId))
    .limit(1);
  if (report.length > 0) return true;

  const issue = await db
    .select({ id: issues.id })
    .from(issues)
    .where(eq(issues.projectDayId, projectDayId))
    .limit(1);
  if (issue.length > 0) return true;

  const photo = await db
    .select({ id: photos.id })
    .from(photos)
    .where(eq(photos.projectDayId, projectDayId))
    .limit(1);
  if (photo.length > 0) return true;

  const day = await db
    .select({ reviewedAt: projectDays.reviewedAt, handoverNote: projectDays.handoverNote })
    .from(projectDays)
    .where(eq(projectDays.id, projectDayId))
    .get();
  if (day?.reviewedAt || day?.handoverNote) return true;

  return false;
}

/**
 * Reconciles project_days with the project's date range.
 *
 * Deliberately NOT a delete-all-and-recreate: that would cascade-delete reports.
 */
export async function syncProjectDays(
  db: DB,
  projectId: string,
  range: { startDate: string; endDate: string },
): Promise<DaySyncResult> {
  const wanted = dateRange(range.startDate, range.endDate);
  const wantedSet = new Set(wanted);

  const existing = await db
    .select({ id: projectDays.id, date: projectDays.date, isOutOfRange: projectDays.isOutOfRange })
    .from(projectDays)
    .where(eq(projectDays.projectId, projectId))
    .orderBy(asc(projectDays.date));

  const existingByDate = new Map(existing.map((d) => [d.date, d]));
  const now = Date.now();
  const result: DaySyncResult = { inserted: 0, deleted: 0, flaggedOutOfRange: 0, keptWithData: [] };

  // 1) insert missing days
  for (const date of wanted) {
    if (existingByDate.has(date)) continue;
    await db.insert(projectDays).values({
      id: randomUUID(),
      projectId,
      date,
      dayType: "event",
      isOutOfRange: false,
      createdAt: now,
      updatedAt: now,
    });
    result.inserted += 1;
  }

  // 2) handle days outside the new range
  for (const day of existing) {
    if (wantedSet.has(day.date)) {
      // Back inside the range again: clear a previous flag.
      if (day.isOutOfRange) {
        await db
          .update(projectDays)
          .set({ isOutOfRange: false, updatedAt: now })
          .where(eq(projectDays.id, day.id));
      }
      continue;
    }

    if (await dayHasData(db, day.id)) {
      await db
        .update(projectDays)
        .set({ isOutOfRange: true, updatedAt: now })
        .where(eq(projectDays.id, day.id));
      result.flaggedOutOfRange += 1;
      result.keptWithData.push(day.date);
    } else {
      await db.delete(projectDays).where(eq(projectDays.id, day.id));
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

export async function createProject(
  db: DB,
  user: ActingUser,
  input: ProjectInput,
): Promise<CreateProjectResult> {
  assertCanCreate(user);

  // A manager may only create projects owned by their own division.
  if (!isAdmin(user) && !user.divisionIds.includes(input.ownerDivisionId)) {
    throw new ForbiddenError("Kamu hanya bisa membuat project untuk divisimu");
  }

  const codeTaken = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.code, input.code.toUpperCase()))
    .get();
  if (codeTaken) throw new ValidationError(`Kode project "${input.code}" sudah dipakai`);

  const id = randomUUID();
  const now = Date.now();

  await db.insert(projects).values({
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
  });

  for (const divisionId of new Set(input.additionalDivisionIds)) {
    await db.insert(projectDivisions).values({ projectId: id, divisionId }).onConflictDoNothing();
  }

  // Members: the creator's own assignment is not implied — §6.1 no.4 is explicit.
  for (const m of input.members) {
    await db
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
      });
  }

  const days = await syncProjectDays(db, id, {
    startDate: input.startDate,
    endDate: input.endDate,
  });

  await audit(db, user, "project.created", id, {
    code: input.code,
    status: input.saveAsDraft ? "draft" : "active",
    members: input.members.length,
    days: days.inserted,
  });

  return { projectId: id, days };
}

export interface UpdateProjectResult {
  days: DaySyncResult;
  datesChanged: boolean;
}

export async function updateProject(
  db: DB,
  user: ActingUser,
  projectId: string,
  input: ProjectInput,
): Promise<UpdateProjectResult> {
  const current = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!current) throw new ValidationError("Project tidak ditemukan");

  const facts = await loadFacts(db, projectId);
  if (!canManageProject(user, facts)) throw new ForbiddenError();

  // §11.3 rule 4: date edits on completed/archived projects are refused.
  const datesChanged =
    current.startDate !== input.startDate || current.endDate !== input.endDate;
  if (datesChanged && (current.status === "completed" || current.status === "archived")) {
    throw new ValidationError(
      "Tanggal tidak bisa diubah saat project selesai/arsip. Buka kembali (reopen) project terlebih dahulu.",
    );
  }

  // Owner division changes are admin-only (it changes who can manage the project).
  if (current.ownerDivisionId !== input.ownerDivisionId && !isAdmin(user)) {
    throw new ForbiddenError("Hanya Admin yang bisa mengubah divisi owner");
  }

  const codeTaken = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.code, input.code.toUpperCase()), ne(projects.id, projectId)))
    .get();
  if (codeTaken) throw new ValidationError(`Kode project "${input.code}" sudah dipakai`);

  await db
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
      timezone: input.timezone,
      ownerDivisionId: input.ownerDivisionId,
      openingWindowStart: input.openingWindowStart,
      openingWindowEnd: input.openingWindowEnd,
      closingWindowStart: input.closingWindowStart,
      closingWindowEnd: input.closingWindowEnd,
      updatedAt: Date.now(),
    })
    .where(eq(projects.id, projectId));

  // Replace additional divisions.
  await db.delete(projectDivisions).where(eq(projectDivisions.projectId, projectId));
  for (const divisionId of new Set(input.additionalDivisionIds)) {
    await db.insert(projectDivisions).values({ projectId, divisionId }).onConflictDoNothing();
  }

  let days: DaySyncResult = { inserted: 0, deleted: 0, flaggedOutOfRange: 0, keptWithData: [] };
  if (datesChanged) {
    // §11.3 rule 3: deleting a day WITH data requires admin.
    days = await syncProjectDaysIfAllowed(db, user, projectId, input);
  }

  await audit(db, user, "project.updated", projectId, {
    datesChanged,
    ...(datesChanged ? days : {}),
  });

  return { days, datesChanged };
}

/**
 * Wraps syncProjectDays so a non-admin cannot trigger deletion of a day that
 * holds data. Because sync deletes only empty days, the admin check applies to
 * the *intent* of shrinking a range that contains data — we simply flag rather
 * than delete for non-admins.
 */
async function syncProjectDaysIfAllowed(
  db: DB,
  user: ActingUser,
  projectId: string,
  input: ProjectInput,
): Promise<DaySyncResult> {
  const result = await syncProjectDays(db, projectId, {
    startDate: input.startDate,
    endDate: input.endDate,
  });

  if (!isAdmin(user) && result.flaggedOutOfRange > 0) {
    await audit(db, user, "project.days_out_of_range", projectId, {
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
  user: ActingUser,
  projectId: string,
  status: ProjectStatus,
  reason?: string,
): Promise<void> {
  const current = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!current) throw new ValidationError("Project tidak ditemukan");

  const facts = await loadFacts(db, projectId);
  if (!canManageProject(user, facts)) throw new ForbiddenError();

  if (current.status === status) return;

  const allowed = PROJECT_STATUS_FLOW[current.status] as readonly string[];
  if (!allowed.includes(status)) {
    throw new ValidationError(`Tidak bisa mengubah status dari ${current.status} ke ${status}`);
  }

  // §6.2: reopening (back to an editable state) needs a recorded reason.
  // Moving forward to `archived` is not a reopen, so it needs none.
  const reopening =
    (current.status === "completed" && status === "active") ||
    (current.status === "archived" && status !== "archived");
  if (reopening && !reason) {
    throw new ValidationError("Alasan wajib diisi saat membuka kembali project");
  }
  if (reopening && !isAdmin(user) && !isManager(user)) throw new ForbiddenError();

  await db
    .update(projects)
    .set({ status, updatedAt: Date.now() })
    .where(eq(projects.id, projectId));

  await audit(db, user, "project.status_changed", projectId, {
    from: current.status,
    to: status,
    reason: reason ?? null,
  });
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

export async function loadFacts(db: DB, projectId: string): Promise<ProjectFacts> {
  const p = await db
    .select({ id: projects.id, status: projects.status, ownerDivisionId: projects.ownerDivisionId })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!p) throw new ValidationError("Project tidak ditemukan");

  const [divs, members] = await Promise.all([
    db
      .select({ divisionId: projectDivisions.divisionId })
      .from(projectDivisions)
      .where(eq(projectDivisions.projectId, projectId)),
    db
      .select({ userId: projectMembers.userId, role: projectMembers.roleInProject })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.isActive, true))),
  ]);

  return {
    id: p.id,
    status: p.status,
    ownerDivisionId: p.ownerDivisionId,
    divisionIds: divs.map((d) => d.divisionId),
    memberIds: members.map((m) => m.userId),
    leadIds: members.filter((m) => m.role === "lead").map((m) => m.userId),
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

async function audit(
  db: DB,
  user: ActingUser,
  action: string,
  entityId: string,
  meta: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: user.id,
    action,
    entityType: "project",
    entityId,
    metaJson: JSON.stringify(meta),
    ip: null,
    createdAt: Date.now(),
  });
}
