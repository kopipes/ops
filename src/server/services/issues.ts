/**
 * Issue service (§4.7, §9.5).
 *
 * Two invariants dominate this module:
 *
 * 1. **Identity is snapshotted at write time** (§9.5 no.2). `author_name`,
 *    `author_role`, `author_division` are copied onto the issue and onto every
 *    timeline entry, so renaming/re-roling/deactivating a user never rewrites
 *    history.
 *
 * 2. **The timeline is append-only** (§9.5 no.3). `issue_updates` rows are only
 *    ever INSERTed. There is no update or delete API for them anywhere — the
 *    only way they change is by adding a new row. Field changes store a
 *    `{field: [old, new]}` diff so the UI can show "what changed".
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  auditLogs,
  divisions,
  issueCategories,
  issueUpdates,
  issues,
  photos,
  projectDays,
  projects,
  users,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import {
  canCloseIssue,
  canCreateIssue,
  canSetIssueStatus,
  canViewProject,
  isAdmin,
  isManagerOfProjectDivision,
  type ActingUser,
} from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";
import { loadFacts } from "./projects";
import type { IssueInput } from "@/lib/schemas";

type DB = BetterSQLite3Database<typeof schema>;

export type IssueStatus = "open" | "in_progress" | "resolved" | "closed";
export type Severity = "low" | "medium" | "high" | "critical";

// ---------------------------------------------------------------------------
// Code generation (§9.5 no.8): EVT-2026-0012-I-007
// ---------------------------------------------------------------------------

/**
 * Per-project, per-year running number. Derived from the project code so an
 * issue can be quoted in a WhatsApp group without ambiguity.
 */
export async function generateIssueCode(db: DB, projectId: string): Promise<string> {
  const project = await db
    .select({ code: projects.code })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get();
  if (!project) throw new ValidationError("Project tidak ditemukan");

  const prefix = `${project.code}-I-`;
  const rows = await db
    .select({ code: issues.code })
    .from(issues)
    .where(sql`${issues.code} LIKE ${`${prefix}%`}`);

  let max = 0;
  for (const r of rows) {
    const n = Number.parseInt(r.code.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Identity snapshot (§9.5 no.2)
// ---------------------------------------------------------------------------

export interface IdentitySnapshot {
  name: string;
  role: string;
  division: string | null;
}

export async function snapshotIdentity(db: DB, userId: string): Promise<IdentitySnapshot> {
  const row = await db
    .select({
      name: users.name,
      role: users.role,
      primaryDivisionId: users.primaryDivisionId,
      divisionName: divisions.name,
    })
    .from(users)
    .leftJoin(divisions, eq(divisions.id, users.primaryDivisionId))
    .where(eq(users.id, userId))
    .get();

  if (!row) throw new ValidationError("User tidak ditemukan");
  return { name: row.name, role: row.role, division: row.divisionName ?? null };
}

// ---------------------------------------------------------------------------
// Diffing (§9.5 no.3)
// ---------------------------------------------------------------------------

/** Fields tracked in the timeline diff. */
const TRACKED_FIELDS = [
  "title",
  "description",
  "category_id",
  "severity",
  "next_step",
  "pic_user_id",
  "pic_external",
  "due_at",
  "status",
] as const;

type TrackedField = (typeof TRACKED_FIELDS)[number];
export type ChangesJson = Partial<Record<TrackedField, [unknown, unknown]>>;

function normalise(v: unknown): unknown {
  if (v === undefined) return null;
  return v;
}

/**
 * Computes the diff between the stored issue and the incoming values.
 * Only changed fields appear, so the timeline stays readable.
 */
export function diffIssue(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ChangesJson {
  const changes: ChangesJson = {};
  for (const field of TRACKED_FIELDS) {
    const a = normalise(before[field]);
    const b = normalise(after[field]);
    if (a !== b) {
      changes[field] = [a, b];
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface CreateIssueResult {
  issueId: string;
  code: string;
}

export async function createIssue(
  db: DB,
  user: ActingUser,
  input: IssueInput,
): Promise<CreateIssueResult> {
  const facts = await loadFacts(db, input.projectId);

  // §4.7: crew (member), manager, admin — in any phase, with or without a report.
  if (!canCreateIssue(user, facts)) {
    throw new ForbiddenError("Kamu tidak bisa membuat issue pada project ini");
  }

  // §4.7: at least one photo.
  if (input.photoIds.length === 0) {
    throw new ValidationError("Minimal 1 foto wajib dilampirkan");
  }

  // Photos must belong to this user and this project (no cross-project reuse).
  await assertPhotosUsable(db, user, input.photoIds, input.projectId);

  // PIC must be a project member when a user is given.
  if (input.picUserId && !facts.memberIds.includes(input.picUserId)) {
    throw new ValidationError("PIC harus member project");
  }

  const category = await db
    .select({ id: issueCategories.id })
    .from(issueCategories)
    .where(eq(issueCategories.id, input.categoryId))
    .get();
  if (!category) throw new ValidationError("Kategori issue tidak ditemukan");

  const identity = await snapshotIdentity(db, user.id);
  const code = await generateIssueCode(db, input.projectId);
  const issueId = randomUUID();
  const now = Date.now();

  await db.insert(issues).values({
    id: issueId,
    code,
    projectId: input.projectId,
    projectDayId: input.projectDayId,
    phase: input.phase ?? null,
    reportId: input.reportId ?? null,
    checkResultId: input.checkResultId ?? null,
    title: input.title,
    description: input.description ?? null,
    categoryId: input.categoryId,
    severity: input.severity,
    status: "open",
    nextStep: input.nextStep,
    picUserId: input.picUserId,
    picExternal: input.picExternal ?? null,
    dueAt: input.dueAt ?? null,
    createdBy: user.id,
    authorName: identity.name,
    authorRole: identity.role,
    authorDivision: identity.division,
    createdAt: now,
    updatedAt: now,
  });

  // First timeline entry: "created".
  await db.insert(issueUpdates).values({
    id: randomUUID(),
    issueId,
    userId: user.id,
    authorName: identity.name,
    authorRole: identity.role,
    authorDivision: identity.division,
    action: "created",
    note: null,
    statusFrom: null,
    statusTo: "open",
    changesJson: JSON.stringify({
      severity: [null, input.severity],
      ...(input.picUserId ? { pic_user_id: [null, input.picUserId] } : {}),
      ...(input.picExternal ? { pic_external: [null, input.picExternal] } : {}),
    } satisfies ChangesJson),
    createdAt: now,
  });

  // Attach photos to the issue (they were uploaded owned by the user).
  await db
    .update(photos)
    .set({ ownerType: "issue", ownerId: issueId })
    .where(and(inArray(photos.id, input.photoIds), eq(photos.uploadedBy, user.id)));

  return { issueId, code };
}

async function assertPhotosUsable(
  db: DB,
  user: ActingUser,
  photoIds: string[],
  projectId: string,
) {
  const rows = await db
    .select({ id: photos.id, uploadedBy: photos.uploadedBy, projectId: photos.projectId, deletedAt: photos.deletedAt })
    .from(photos)
    .where(inArray(photos.id, photoIds));

  if (rows.length !== new Set(photoIds).size) {
    throw new ValidationError("Ada foto yang tidak ditemukan");
  }
  for (const r of rows) {
    if (r.deletedAt) throw new ValidationError("Ada foto yang sudah dihapus");
    if (r.uploadedBy !== user.id) throw new ValidationError("Foto milik user lain tidak bisa dipakai");
    if (r.projectId !== projectId) throw new ValidationError("Foto berasal dari project lain");
  }
}

// ---------------------------------------------------------------------------
// Update (field edits) — always produces a timeline entry
// ---------------------------------------------------------------------------

export async function updateIssueFields(
  db: DB,
  user: ActingUser,
  issueId: string,
  input: Omit<IssueInput, "photoIds"> & { photoIds?: string[] },
): Promise<{ changed: boolean; changes: ChangesJson }> {
  const current = await db.select().from(issues).where(eq(issues.id, issueId)).get();
  if (!current || current.deletedAt) throw new ValidationError("Issue tidak ditemukan");

  const facts = await loadFacts(db, current.projectId);
  if (!canSetIssueStatus(user, facts, current.status)) {
    throw new ForbiddenError("Kamu tidak bisa mengubah issue ini");
  }

  if (input.picUserId && !facts.memberIds.includes(input.picUserId)) {
    throw new ValidationError("PIC harus member project");
  }

  const after = {
    title: input.title,
    description: input.description ?? null,
    category_id: input.categoryId,
    severity: input.severity,
    next_step: input.nextStep,
    pic_user_id: input.picUserId,
    pic_external: input.picExternal ?? null,
    due_at: input.dueAt ?? null,
    status: current.status,
  };

  const changes = diffIssue(
    {
      title: current.title,
      description: current.description,
      category_id: current.categoryId,
      severity: current.severity,
      next_step: current.nextStep,
      pic_user_id: current.picUserId,
      pic_external: current.picExternal,
      due_at: current.dueAt,
      status: current.status,
    },
    after,
  );

  // Appending photos is also a timeline event (§9.5 no.3).
  const newPhotoIds = input.photoIds ?? [];
  if (newPhotoIds.length > 0) {
    await assertPhotosUsable(db, user, newPhotoIds, current.projectId);
  }

  if (Object.keys(changes).length === 0 && newPhotoIds.length === 0) {
    return { changed: false, changes: {} };
  }

  const now = Date.now();
  await db
    .update(issues)
    .set({
      title: input.title,
      description: input.description ?? null,
      categoryId: input.categoryId,
      severity: input.severity,
      nextStep: input.nextStep,
      picUserId: input.picUserId,
      picExternal: input.picExternal ?? null,
      dueAt: input.dueAt ?? null,
      updatedAt: now,
    })
    .where(eq(issues.id, issueId));

  if (newPhotoIds.length > 0) {
    await db
      .update(photos)
      .set({ ownerType: "issue", ownerId: issueId })
      .where(and(inArray(photos.id, newPhotoIds), eq(photos.uploadedBy, user.id)));
  }

  const identity = await snapshotIdentity(db, user.id);
  await db.insert(issueUpdates).values({
    id: randomUUID(),
    issueId,
    userId: user.id,
    authorName: identity.name,
    authorRole: identity.role,
    authorDivision: identity.division,
    action: newPhotoIds.length > 0 && Object.keys(changes).length === 0 ? "photo_added" : "edited",
    note: null,
    statusFrom: null,
    statusTo: null,
    changesJson: JSON.stringify(changes),
    createdAt: now,
  });

  return { changed: true, changes };
}

// ---------------------------------------------------------------------------
// Status lifecycle (§4.7)
// ---------------------------------------------------------------------------

/**
 * Allowed transitions:
 *   open -> in_progress -> resolved -> closed
 *   closed -> open (reopen, manager/admin only)
 * Crew may only move forward and may NOT set `closed` (§2.3 [ASUMSI]).
 */
const ALLOWED: Record<IssueStatus, IssueStatus[]> = {
  open: ["in_progress", "resolved", "closed"],
  in_progress: ["open", "resolved", "closed"],
  resolved: ["in_progress", "closed", "open"],
  closed: ["open"],
};

export async function changeIssueStatus(
  db: DB,
  user: ActingUser,
  issueId: string,
  status: IssueStatus,
  note?: string,
): Promise<void> {
  const current = await db.select().from(issues).where(eq(issues.id, issueId)).get();
  if (!current || current.deletedAt) throw new ValidationError("Issue tidak ditemukan");

  const facts = await loadFacts(db, current.projectId);

  if (!canSetIssueStatus(user, facts, status)) {
    throw new ForbiddenError(
      status === "closed"
        ? "Hanya Manager atau Admin yang bisa menutup (Closed) issue"
        : "Kamu tidak bisa mengubah status issue ini",
    );
  }

  if (current.status === status) return;

  const allowed = ALLOWED[current.status];
  if (!allowed.includes(status)) {
    throw new ValidationError(`Tidak bisa mengubah status dari ${current.status} ke ${status}`);
  }

  // Reopening a closed issue is a manager/admin action.
  if (current.status === "closed" && !canCloseIssue(user, facts)) {
    throw new ForbiddenError("Hanya Manager atau Admin yang bisa membuka kembali issue");
  }

  const now = Date.now();
  await db
    .update(issues)
    .set({
      status,
      updatedAt: now,
      resolvedAt: status === "resolved" ? now : status === "open" ? null : current.resolvedAt,
      resolvedBy: status === "resolved" ? user.id : status === "open" ? null : current.resolvedBy,
      closedAt: status === "closed" ? now : current.closedAt,
      closedBy: status === "closed" ? user.id : current.closedBy,
    })
    .where(eq(issues.id, issueId));

  const identity = await snapshotIdentity(db, user.id);
  await db.insert(issueUpdates).values({
    id: randomUUID(),
    issueId,
    userId: user.id,
    authorName: identity.name,
    authorRole: identity.role,
    authorDivision: identity.division,
    action: current.status === "closed" && status === "open" ? "reopened" : "status_changed",
    note: note ?? null,
    statusFrom: current.status,
    statusTo: status,
    changesJson: JSON.stringify({ status: [current.status, status] } satisfies ChangesJson),
    createdAt: now,
  });
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function addIssueComment(
  db: DB,
  user: ActingUser,
  issueId: string,
  note: string,
  photoIds: string[] = [],
): Promise<void> {
  const current = await db.select().from(issues).where(eq(issues.id, issueId)).get();
  if (!current || current.deletedAt) throw new ValidationError("Issue tidak ditemukan");

  const facts = await loadFacts(db, current.projectId);
  if (!canCreateIssue(user, facts)) throw new ForbiddenError();

  if (photoIds.length > 0) {
    await assertPhotosUsable(db, user, photoIds, current.projectId);
  }

  const identity = await snapshotIdentity(db, user.id);
  const updateId = randomUUID();
  const now = Date.now();

  await db.insert(issueUpdates).values({
    id: updateId,
    issueId,
    userId: user.id,
    authorName: identity.name,
    authorRole: identity.role,
    authorDivision: identity.division,
    action: "comment",
    note,
    statusFrom: null,
    statusTo: null,
    changesJson: null,
    createdAt: now,
  });

  if (photoIds.length > 0) {
    await db
      .update(photos)
      .set({ ownerType: "issue_update", ownerId: updateId })
      .where(and(inArray(photos.id, photoIds), eq(photos.uploadedBy, user.id)));
  }
}

/**
 * Soft delete (§9.5 no.6): admin/manager only, reason mandatory, always audited.
 * Never a hard delete.
 */
export async function softDeleteIssue(
  db: DB,
  user: ActingUser,
  issueId: string,
  reason: string,
): Promise<void> {
  if (!reason.trim()) throw new ValidationError("Alasan penghapusan wajib diisi");

  const current = await db.select().from(issues).where(eq(issues.id, issueId)).get();
  if (!current || current.deletedAt) throw new ValidationError("Issue tidak ditemukan");

  const facts = await loadFacts(db, current.projectId);
  // §9.5 no.6: only Admin/Manager.
  if (!isAdmin(user) && !isManagerOfProjectDivision(user, facts)) {
    throw new ForbiddenError("Hanya Manager atau Admin yang bisa menghapus issue");
  }

  const now = Date.now();
  await db
    .update(issues)
    .set({ deletedAt: now, deletedBy: user.id, deleteReason: reason.trim(), updatedAt: now })
    .where(eq(issues.id, issueId));

  await db.insert(issueUpdates).values({
    id: randomUUID(),
    issueId,
    userId: user.id,
    authorName: (await snapshotIdentity(db, user.id)).name,
    authorRole: user.role,
    authorDivision: null,
    action: "comment",
    note: `Dihapus oleh ${user.role} — ${reason.trim()}`,
    statusFrom: null,
    statusTo: null,
    changesJson: null,
    createdAt: now,
  });

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: user.id,
    action: "issue.soft_deleted",
    entityType: "issue",
    entityId: issueId,
    metaJson: JSON.stringify({ reason: reason.trim(), code: current.code }),
    ip: null,
    createdAt: now,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface IssueListItem {
  id: string;
  code: string;
  title: string;
  severity: Severity;
  status: IssueStatus;
  nextStep: string;
  categoryName: string | null;
  projectName: string;
  projectId: string;
  authorName: string;
  authorRole: string;
  authorDivision: string | null;
  createdAt: number;
  dueAt: number | null;
  picName: string | null;
  picExternal: string | null;
  dayDate: string | null;
  photoCount: number;
  commentCount: number;
}

const listSelect = {
  id: issues.id,
  code: issues.code,
  title: issues.title,
  severity: issues.severity,
  status: issues.status,
  nextStep: issues.nextStep,
  projectId: issues.projectId,
  projectName: projects.name,
  authorName: issues.authorName,
  authorRole: issues.authorRole,
  authorDivision: issues.authorDivision,
  createdAt: issues.createdAt,
  dueAt: issues.dueAt,
  picExternal: issues.picExternal,
  dayDate: projectDays.date,
  categoryName: issueCategories.name,
} as const;

/** Issues visible to the user across their projects (§2.2). */
export async function listIssues(
  db: DB,
  user: ActingUser,
  visibleProjectIds: string[],
  opts: { status?: IssueStatus; projectId?: string; severity?: Severity } = {},
): Promise<IssueListItem[]> {
  if (visibleProjectIds.length === 0) return [];

  const conditions = [
    inArray(issues.projectId, visibleProjectIds),
    isNull(issues.deletedAt),
  ];
  if (opts.status) conditions.push(eq(issues.status, opts.status));
  if (opts.projectId) conditions.push(eq(issues.projectId, opts.projectId));
  if (opts.severity) conditions.push(eq(issues.severity, opts.severity));

  const rows = await db
    .select(listSelect)
    .from(issues)
    .innerJoin(projects, eq(projects.id, issues.projectId))
    .leftJoin(projectDays, eq(projectDays.id, issues.projectDayId))
    .leftJoin(issueCategories, eq(issueCategories.id, issues.categoryId))
    .where(and(...conditions))
    .orderBy(desc(issues.createdAt))
    .limit(200);

  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const photoCounts = await db
    .select({ ownerId: photos.ownerId, count: sql<number>`count(*)` })
    .from(photos)
    .where(and(eq(photos.ownerType, "issue"), inArray(photos.ownerId, ids), isNull(photos.deletedAt)))
    .groupBy(photos.ownerId);

  const commentCounts = await db
    .select({ issueId: issueUpdates.issueId, count: sql<number>`count(*)` })
    .from(issueUpdates)
    .where(and(inArray(issueUpdates.issueId, ids), eq(issueUpdates.action, "comment")))
    .groupBy(issueUpdates.issueId);

  const picIds = rows.map((r) => r.id);
  const pics = await db
    .select({ id: issues.id, picName: users.name })
    .from(issues)
    .leftJoin(users, eq(users.id, issues.picUserId))
    .where(inArray(issues.id, picIds));
  const picByIssue = new Map(pics.map((p) => [p.id, p.picName]));

  return rows.map((r) => ({
    ...r,
    severity: r.severity as Severity,
    status: r.status as IssueStatus,
    picName: picByIssue.get(r.id) ?? null,
    photoCount: Number(photoCounts.find((c) => c.ownerId === r.id)?.count ?? 0),
    commentCount: Number(commentCounts.find((c) => c.issueId === r.id)?.count ?? 0),
  }));
}

export interface TimelineEntry {
  id: string;
  action: string;
  note: string | null;
  authorName: string;
  authorRole: string;
  authorDivision: string | null;
  statusFrom: string | null;
  statusTo: string | null;
  changes: ChangesJson | null;
  createdAt: number;
  photos: { id: string; thumbPath: string }[];
}

export interface IssueDetail {
  issue: IssueListItem & {
    description: string | null;
    categoryId: string;
    projectDayId: string | null;
    phase: string | null;
    picUserId: string | null;
    deletedAt: number | null;
    deletedBy: string | null;
    deleteReason: string | null;
  };
  timeline: TimelineEntry[];
  /** Whether the acting user may mutate this issue. */
  canEdit: boolean;
  canClose: boolean;
}

export async function getIssueDetail(
  db: DB,
  user: ActingUser,
  issueId: string,
): Promise<IssueDetail | null> {
  const row = await db.select().from(issues).where(eq(issues.id, issueId)).get();
  if (!row) return null;

  const project = await db
    .select({ name: projects.name })
    .from(projects)
    .where(eq(projects.id, row.projectId))
    .get();

  const facts = await loadFacts(db, row.projectId);
  // §2.2: reading an issue requires seeing its project.
  if (!canViewProject(user, facts)) return null;

  const updates = await db
    .select({
      id: issueUpdates.id,
      action: issueUpdates.action,
      note: issueUpdates.note,
      authorName: issueUpdates.authorName,
      authorRole: issueUpdates.authorRole,
      authorDivision: issueUpdates.authorDivision,
      statusFrom: issueUpdates.statusFrom,
      statusTo: issueUpdates.statusTo,
      changesJson: issueUpdates.changesJson,
      createdAt: issueUpdates.createdAt,
    })
    .from(issueUpdates)
    .where(eq(issueUpdates.issueId, issueId))
    .orderBy(asc(issueUpdates.createdAt));

  const updateIds = updates.map((u) => u.id);
  const updatePhotos =
    updateIds.length === 0
      ? []
      : await db
          .select({ id: photos.id, ownerId: photos.ownerId, thumbPath: photos.thumbPath })
          .from(photos)
          .where(
            and(
              eq(photos.ownerType, "issue_update"),
              inArray(photos.ownerId, updateIds),
              isNull(photos.deletedAt),
            ),
          );

  const issuePhotos = await db
    .select({ id: photos.id, thumbPath: photos.thumbPath })
    .from(photos)
    .where(and(eq(photos.ownerType, "issue"), eq(photos.ownerId, issueId), isNull(photos.deletedAt)));

  const pic = row.picUserId
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, row.picUserId)).get()
    : null;

  const category = await db
    .select({ name: issueCategories.name })
    .from(issueCategories)
    .where(eq(issueCategories.id, row.categoryId))
    .get();

  const day = row.projectDayId
    ? await db
        .select({ date: projectDays.date })
        .from(projectDays)
        .where(eq(projectDays.id, row.projectDayId))
        .get()
    : null;

  return {
    issue: {
      id: row.id,
      code: row.code,
      title: row.title,
      severity: row.severity as Severity,
      status: row.status as IssueStatus,
      nextStep: row.nextStep,
      projectId: row.projectId,
      projectName: project?.name ?? "",
      authorName: row.authorName,
      authorRole: row.authorRole,
      authorDivision: row.authorDivision,
      createdAt: row.createdAt,
      dueAt: row.dueAt,
      picExternal: row.picExternal,
      picName: pic?.name ?? null,
      categoryName: category?.name ?? null,
      dayDate: day?.date ?? null,
      photoCount: issuePhotos.length,
      commentCount: updates.filter((u) => u.action === "comment").length,
      description: row.description,
      categoryId: row.categoryId,
      projectDayId: row.projectDayId,
      phase: row.phase,
      picUserId: row.picUserId,
      deletedAt: row.deletedAt,
      deletedBy: row.deletedBy,
      deleteReason: row.deleteReason,
    },
    timeline: updates.map((u) => ({
      id: u.id,
      action: u.action,
      note: u.note,
      authorName: u.authorName,
      authorRole: u.authorRole,
      authorDivision: u.authorDivision,
      statusFrom: u.statusFrom,
      statusTo: u.statusTo,
      changes: u.changesJson ? (JSON.parse(u.changesJson) as ChangesJson) : null,
      createdAt: u.createdAt,
      photos: updatePhotos
        .filter((p) => p.ownerId === u.id)
        .map((p) => ({ id: p.id, thumbPath: p.thumbPath })),
    })),
    canEdit: canSetIssueStatus(user, facts, row.status),
    canClose: canCloseIssue(user, facts),
  };
}

/**
 * §4.7 / §4.3 no.5: issues carried over into a day — everything not CLOSED,
 * created on or before that day.
 */
export async function listCarryOverIssues(
  db: DB,
  projectId: string,
  dayDate: string,
): Promise<{ id: string; code: string; title: string; severity: Severity; status: IssueStatus }[]> {
  const rows = await db
    .select({
      id: issues.id,
      code: issues.code,
      title: issues.title,
      severity: issues.severity,
      status: issues.status,
    })
    .from(issues)
    .leftJoin(projectDays, eq(projectDays.id, issues.projectDayId))
    .where(
      and(
        eq(issues.projectId, projectId),
        isNull(issues.deletedAt),
        ne(issues.status, "closed"),
        sql`(${projectDays.date} IS NULL OR ${projectDays.date} <= ${dayDate})`,
      ),
    )
    // Alphabetical severity order would be medium, low, high, critical — wrong.
    // Rank explicitly so the most urgent issues surface first.
    .orderBy(
      sql`case ${issues.severity}
            when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
      desc(issues.createdAt),
    )
    .limit(50);

  return rows.map((r) => ({
    ...r,
    severity: r.severity as Severity,
    status: r.status as IssueStatus,
  }));
}

/** Photos attached to an issue (for the detail gallery). */
export async function listIssuePhotos(db: DB, issueId: string) {
  return db
    .select({ id: photos.id, thumbPath: photos.thumbPath })
    .from(photos)
    .where(and(eq(photos.ownerType, "issue"), eq(photos.ownerId, issueId), isNull(photos.deletedAt)));
}
