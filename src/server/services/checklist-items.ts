/**
 * Master checklist items (§5.1).
 *
 * Key invariant enforced here, not just in the UI:
 *   an item that has ever been used is NEVER hard-deleted — only deactivated.
 * Deactivation must also leave existing project snapshots untouched (§14 AC).
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  auditLogs,
  checklistItems,
  checklistTemplateItems,
  divisions,
  projectChecklistItems,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import {
  canManageChecklistItem,
  type ActingUser,
} from "@/server/permissions";
import type { ChecklistItemInput } from "@/lib/schemas";

type DB = BetterSQLite3Database<typeof schema>;

export class ForbiddenError extends Error {
  constructor(message = "Tidak punya akses") {
    super(message);
    this.name = "ForbiddenError";
  }
}
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface ChecklistItemRow {
  id: string;
  label: string;
  description: string | null;
  phase: "opening" | "monitoring" | "closing";
  categoryId: string;
  categoryName: string;
  divisionId: string | null;
  divisionName: string | null;
  isRequired: boolean;
  requiresPhoto: boolean;
  sortOrder: number;
  isActive: boolean;
  /** True once the item has been snapshotted into any project. */
  isUsed: boolean;
}

/**
 * Visible master items: global items (divisionId NULL) plus items belonging to
 * any of the user's divisions. Admin sees everything.
 */
export async function listChecklistItems(
  db: DB,
  user: ActingUser,
  opts: { includeInactive?: boolean; phase?: string; categoryId?: string } = {},
): Promise<ChecklistItemRow[]> {
  const conditions = [];

  if (user.role === "admin") {
    // no division filter
  } else if (user.divisionIds.length > 0) {
    conditions.push(
      or(isNull(checklistItems.divisionId), inArray(checklistItems.divisionId, user.divisionIds))!,
    );
  } else {
    conditions.push(isNull(checklistItems.divisionId));
  }

  if (!opts.includeInactive) conditions.push(eq(checklistItems.isActive, true));
  if (opts.phase) conditions.push(eq(checklistItems.phase, opts.phase as "opening"));
  if (opts.categoryId) conditions.push(eq(checklistItems.categoryId, opts.categoryId));

  const rows = await db
    .select({
      id: checklistItems.id,
      label: checklistItems.label,
      description: checklistItems.description,
      phase: checklistItems.phase,
      categoryId: checklistItems.categoryId,
      categoryName: sql<string>`coalesce(
        (select c.name from checklist_categories c where c.id = ${checklistItems.categoryId}), ''
      )`,
      divisionId: checklistItems.divisionId,
      divisionName: divisions.name,
      isRequired: checklistItems.isRequired,
      requiresPhoto: checklistItems.requiresPhoto,
      sortOrder: checklistItems.sortOrder,
      isActive: checklistItems.isActive,
      isUsed: sql<number>`case when exists(
        select 1 from project_checklist_items pci where pci.source_item_id = ${checklistItems.id}
      ) or exists(
        select 1 from checklist_template_items cti where cti.checklist_item_id = ${checklistItems.id}
      ) then 1 else 0 end`,
    })
    .from(checklistItems)
    .leftJoin(divisions, eq(divisions.id, checklistItems.divisionId))
    .where(and(...conditions))
    .orderBy(asc(checklistItems.phase), asc(checklistItems.sortOrder), asc(checklistItems.label));

  return rows.map((r) => ({ ...r, isUsed: Boolean(r.isUsed) }));
}

/** Throws ForbiddenError unless the user may manage this item (§2.3). */
export async function assertCanManageItem(
  db: DB,
  user: ActingUser,
  itemId: string | null,
): Promise<void> {
  const existing = itemId
    ? await db
        .select({ divisionId: checklistItems.divisionId })
        .from(checklistItems)
        .where(eq(checklistItems.id, itemId))
        .get()
    : null;

  if (itemId && !existing) throw new ValidationError("Item tidak ditemukan");
  if (!canManageChecklistItem(user, existing?.divisionId ?? null)) throw new ForbiddenError();
}

export async function createChecklistItem(
  db: DB,
  user: ActingUser,
  input: ChecklistItemInput,
): Promise<string> {
  // Managers may only create items for their own division — never global.
  if (!canManageChecklistItem(user, input.divisionId)) {
    throw new ForbiddenError(
      input.divisionId === null
        ? "Hanya Admin yang bisa membuat item global"
        : "Kamu hanya bisa membuat item untuk divisimu",
    );
  }

  const id = randomUUID();
  const now = Date.now();
  await db.insert(checklistItems).values({
    id,
    label: input.label,
    description: input.description ?? null,
    phase: input.phase,
    categoryId: input.categoryId,
    divisionId: input.divisionId,
    isRequired: input.isRequired,
    requiresPhoto: input.requiresPhoto,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
    createdBy: user.id,
    createdAt: now,
    updatedAt: now,
  });

  await audit(db, user, "checklist_item.created", id, { label: input.label });
  return id;
}

export async function updateChecklistItem(
  db: DB,
  user: ActingUser,
  itemId: string,
  input: ChecklistItemInput,
): Promise<void> {
  await assertCanManageItem(db, user, itemId);

  // Moving an item between divisions (including to/from global) is admin-only,
  // because it changes who can see and manage it.
  const current = await db
    .select({ divisionId: checklistItems.divisionId })
    .from(checklistItems)
    .where(eq(checklistItems.id, itemId))
    .get();

  const divisionChanged = (current?.divisionId ?? null) !== input.divisionId;
  if (divisionChanged && user.role !== "admin") {
    throw new ForbiddenError("Hanya Admin yang bisa memindahkan item antar divisi");
  }
  if (divisionChanged && !canManageChecklistItem(user, input.divisionId)) {
    throw new ForbiddenError();
  }

  await db
    .update(checklistItems)
    .set({
      label: input.label,
      description: input.description ?? null,
      phase: input.phase,
      categoryId: input.categoryId,
      divisionId: input.divisionId,
      isRequired: input.isRequired,
      requiresPhoto: input.requiresPhoto,
      isActive: input.isActive,
      sortOrder: input.sortOrder,
      updatedAt: Date.now(),
    })
    .where(eq(checklistItems.id, itemId));

  await audit(db, user, "checklist_item.updated", itemId, { label: input.label });
}

/**
 * Deactivate (soft delete). §5.1: items that were used are never removed.
 * Even unused items are only deactivated, so a template reference can never dangle.
 */
export async function deactivateChecklistItem(
  db: DB,
  user: ActingUser,
  itemId: string,
): Promise<void> {
  await assertCanManageItem(db, user, itemId);
  await db
    .update(checklistItems)
    .set({ isActive: false, updatedAt: Date.now() })
    .where(eq(checklistItems.id, itemId));
  await audit(db, user, "checklist_item.deactivated", itemId, {});
}

export async function reactivateChecklistItem(
  db: DB,
  user: ActingUser,
  itemId: string,
): Promise<void> {
  await assertCanManageItem(db, user, itemId);
  await db
    .update(checklistItems)
    .set({ isActive: true, updatedAt: Date.now() })
    .where(eq(checklistItems.id, itemId));
  await audit(db, user, "checklist_item.reactivated", itemId, {});
}

/** Persists an explicit ordering. Ids not passed keep their current order. */
export async function reorderChecklistItems(
  db: DB,
  user: ActingUser,
  ids: string[],
): Promise<void> {
  for (const [index, id] of ids.entries()) {
    await assertCanManageItem(db, user, id);
  }
  const now = Date.now();
  for (const [index, id] of ids.entries()) {
    await db
      .update(checklistItems)
      .set({ sortOrder: index, updatedAt: now })
      .where(eq(checklistItems.id, id));
  }
  await audit(db, user, "checklist_item.reordered", ids[0] ?? "", { count: ids.length });
}

/** §14 AC: deactivating a master item must not change existing project checklists. */
export async function projectSnapshotCountForItem(db: DB, itemId: string): Promise<number> {
  const rows = await db
    .select({ id: projectChecklistItems.id })
    .from(projectChecklistItems)
    .where(eq(projectChecklistItems.sourceItemId, itemId));
  return rows.length;
}

/** Items referenced by a template — used to warn before deactivation. */
export async function templateUsageCountForItem(db: DB, itemId: string): Promise<number> {
  const rows = await db
    .select({ templateId: checklistTemplateItems.templateId })
    .from(checklistTemplateItems)
    .where(eq(checklistTemplateItems.checklistItemId, itemId));
  return rows.length;
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
    entityType: "checklist_item",
    entityId,
    metaJson: JSON.stringify(meta),
    ip: null,
    createdAt: Date.now(),
  });
}
