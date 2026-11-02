/**
 * Checklist categories (§5.1) and issue categories (§11.5).
 *
 * Checklist categories are admin-managed master data; issue categories are
 * admin-only per §2.3 ("Kelola master checklist item & kategori" / issue
 * categories are listed under admin surfaces in §12).
 */
import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { auditLogs, checklistCategories, issueCategories } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { isAdmin, type ActingUser } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";
import type { CategoryInput, IssueCategoryInput } from "@/lib/schemas";

type DB = BetterSQLite3Database<typeof schema>;

export interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  itemCount: number;
}

// ---------------------------------------------------------------------------
// Checklist categories
// ---------------------------------------------------------------------------

export const canManageCategories = (u: ActingUser) => u.isActive && isAdmin(u);

export async function listChecklistCategories(
  db: DB,
  opts: { includeInactive?: boolean } = {},
): Promise<CategoryRow[]> {
  const rows = await db
    .select({
      id: checklistCategories.id,
      name: checklistCategories.name,
      sortOrder: checklistCategories.sortOrder,
      isActive: checklistCategories.isActive,
    })
    .from(checklistCategories)
    .orderBy(asc(checklistCategories.sortOrder), asc(checklistCategories.name));

  return rows
    .filter((r) => opts.includeInactive || r.isActive)
    .map((r) => ({ ...r, itemCount: 0 }));
}

export async function createChecklistCategory(
  db: DB,
  user: ActingUser,
  input: CategoryInput,
): Promise<string> {
  if (!canManageCategories(user)) throw new ForbiddenError();
  await assertUniqueCategoryName(db, input.name, null);

  const id = randomUUID();
  const now = Date.now();
  await db.insert(checklistCategories).values({
    id,
    name: input.name,
    sortOrder: input.sortOrder,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await audit(db, user, "checklist_category.created", "checklist_category", id, { name: input.name });
  return id;
}

export async function updateChecklistCategory(
  db: DB,
  user: ActingUser,
  id: string,
  input: CategoryInput,
): Promise<void> {
  if (!canManageCategories(user)) throw new ForbiddenError();
  const existing = await db
    .select({ id: checklistCategories.id })
    .from(checklistCategories)
    .where(eq(checklistCategories.id, id))
    .get();
  if (!existing) throw new ValidationError("Kategori tidak ditemukan");

  await assertUniqueCategoryName(db, input.name, id);
  await db
    .update(checklistCategories)
    .set({ name: input.name, sortOrder: input.sortOrder, updatedAt: Date.now() })
    .where(eq(checklistCategories.id, id));
  await audit(db, user, "checklist_category.updated", "checklist_category", id, { name: input.name });
}

/**
 * Categories are never hard-deleted: items reference them by id, and the
 * checklist snapshot copies the name, so old reports must stay readable.
 */
export async function deactivateChecklistCategory(
  db: DB,
  user: ActingUser,
  id: string,
): Promise<void> {
  if (!canManageCategories(user)) throw new ForbiddenError();
  await db
    .update(checklistCategories)
    .set({ isActive: false, updatedAt: Date.now() })
    .where(eq(checklistCategories.id, id));
  await audit(db, user, "checklist_category.deactivated", "checklist_category", id, {});
}

async function assertUniqueCategoryName(db: DB, name: string, exceptId: string | null) {
  const rows = await db
    .select({ id: checklistCategories.id, name: checklistCategories.name })
    .from(checklistCategories);
  const clash = rows.find(
    (r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== exceptId,
  );
  if (clash) throw new ValidationError(`Kategori "${name}" sudah ada`);
}

// ---------------------------------------------------------------------------
// Issue categories (§11.5)
// ---------------------------------------------------------------------------

export interface IssueCategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export const canManageIssueCategories = (u: ActingUser) => u.isActive && isAdmin(u);

export async function listIssueCategories(
  db: DB,
  opts: { includeInactive?: boolean } = {},
): Promise<IssueCategoryRow[]> {
  const rows = await db
    .select({
      id: issueCategories.id,
      name: issueCategories.name,
      sortOrder: issueCategories.sortOrder,
      isActive: issueCategories.isActive,
    })
    .from(issueCategories)
    .orderBy(asc(issueCategories.sortOrder), asc(issueCategories.name));

  return opts.includeInactive ? rows : rows.filter((r) => r.isActive);
}

export async function createIssueCategory(
  db: DB,
  user: ActingUser,
  input: IssueCategoryInput,
): Promise<string> {
  if (!canManageIssueCategories(user)) throw new ForbiddenError();
  await assertUniqueIssueCategoryName(db, input.name, null);

  const id = randomUUID();
  const now = Date.now();
  await db.insert(issueCategories).values({
    id,
    name: input.name,
    sortOrder: input.sortOrder,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await audit(db, user, "issue_category.created", "issue_category", id, { name: input.name });
  return id;
}

export async function updateIssueCategory(
  db: DB,
  user: ActingUser,
  id: string,
  input: IssueCategoryInput,
): Promise<void> {
  if (!canManageIssueCategories(user)) throw new ForbiddenError();
  const existing = await db
    .select({ id: issueCategories.id })
    .from(issueCategories)
    .where(eq(issueCategories.id, id))
    .get();
  if (!existing) throw new ValidationError("Kategori issue tidak ditemukan");

  await assertUniqueIssueCategoryName(db, input.name, id);
  await db
    .update(issueCategories)
    .set({ name: input.name, sortOrder: input.sortOrder, updatedAt: Date.now() })
    .where(eq(issueCategories.id, id));
  await audit(db, user, "issue_category.updated", "issue_category", id, { name: input.name });
}

export async function deactivateIssueCategory(
  db: DB,
  user: ActingUser,
  id: string,
): Promise<void> {
  if (!canManageIssueCategories(user)) throw new ForbiddenError();
  await db
    .update(issueCategories)
    .set({ isActive: false, updatedAt: Date.now() })
    .where(eq(issueCategories.id, id));
  await audit(db, user, "issue_category.deactivated", "issue_category", id, {});
}

async function assertUniqueIssueCategoryName(db: DB, name: string, exceptId: string | null) {
  const rows = await db
    .select({ id: issueCategories.id, name: issueCategories.name })
    .from(issueCategories);
  const clash = rows.find(
    (r) => r.name.toLowerCase() === name.toLowerCase() && r.id !== exceptId,
  );
  if (clash) throw new ValidationError(`Kategori issue "${name}" sudah ada`);
}

async function audit(
  db: DB,
  user: ActingUser,
  action: string,
  entityType: string,
  entityId: string,
  meta: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: user.id,
    action,
    entityType,
    entityId,
    metaJson: JSON.stringify(meta),
    ip: null,
    createdAt: Date.now(),
  });
}
