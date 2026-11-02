/**
 * Checklist templates (§5.2).
 *
 * A template is name + description + items with per-item ordering and
 * required/photo overrides. Three creation paths:
 *   1. manual  — pick items from master
 *   2. duplicate — copy an existing template
 *   3. from project — copy a project's checklist, promoting custom items to master
 */
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  auditLogs,
  checklistCategories,
  checklistItems,
  checklistTemplateItems,
  checklistTemplates,
  divisions,
  projectChecklistItems,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { isAdmin, isManager, type ActingUser } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";
import type { TemplateFromProjectInput, TemplateInput } from "@/lib/schemas";

type DB = BetterSQLite3Database<typeof schema>;

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  divisionId: string | null;
  divisionName: string | null;
  isActive: boolean;
  itemCount: number;
  phases: { opening: number; monitoring: number; closing: number };
}

export interface TemplateItemDetail {
  checklistItemId: string;
  label: string;
  phase: "opening" | "monitoring" | "closing";
  categoryName: string;
  sortOrder: number;
  isRequiredOverride: boolean | null;
  requiresPhotoOverride: boolean | null;
  /** Effective values after applying overrides. */
  isRequired: boolean;
  requiresPhoto: boolean;
}

/**
 * §2.3: managers manage templates (not restricted to a division — templates are
 * a shared, reusable asset; the visibility filter keeps them relevant).
 */
export function canManageTemplates(user: ActingUser): boolean {
  return user.isActive && (isAdmin(user) || isManager(user));
}

/** Templates visible to the user: global + own divisions; admin sees all. */
export async function listTemplates(
  db: DB,
  user: ActingUser,
  opts: { includeInactive?: boolean } = {},
): Promise<TemplateSummary[]> {
  const conditions = [];
  if (user.role !== "admin" && user.divisionIds.length > 0) {
    conditions.push(
      or(
        isNull(checklistTemplates.divisionId),
        inArray(checklistTemplates.divisionId, user.divisionIds),
      )!,
    );
  } else if (user.role !== "admin") {
    conditions.push(isNull(checklistTemplates.divisionId));
  }
  if (!opts.includeInactive) conditions.push(eq(checklistTemplates.isActive, true));

  const templates = await db
    .select({
      id: checklistTemplates.id,
      name: checklistTemplates.name,
      description: checklistTemplates.description,
      divisionId: checklistTemplates.divisionId,
      divisionName: divisions.name,
      isActive: checklistTemplates.isActive,
    })
    .from(checklistTemplates)
    .leftJoin(divisions, eq(divisions.id, checklistTemplates.divisionId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(checklistTemplates.name));

  if (templates.length === 0) return [];

  const counts = await db
    .select({
      templateId: checklistTemplateItems.templateId,
      phase: checklistItems.phase,
    })
    .from(checklistTemplateItems)
    .innerJoin(checklistItems, eq(checklistItems.id, checklistTemplateItems.checklistItemId))
    .where(
      inArray(
        checklistTemplateItems.templateId,
        templates.map((t) => t.id),
      ),
    );

  return templates.map((t) => {
    const mine = counts.filter((c) => c.templateId === t.id);
    return {
      ...t,
      itemCount: mine.length,
      phases: {
        opening: mine.filter((c) => c.phase === "opening").length,
        monitoring: mine.filter((c) => c.phase === "monitoring").length,
        closing: mine.filter((c) => c.phase === "closing").length,
      },
    };
  });
}

export async function getTemplate(
  db: DB,
  user: ActingUser,
  templateId: string,
): Promise<{ summary: TemplateSummary; items: TemplateItemDetail[] } | null> {
  const summaries = await listTemplates(db, user, { includeInactive: true });
  const summary = summaries.find((t) => t.id === templateId);
  if (!summary) return null;

  const rows = await db
    .select({
      checklistItemId: checklistTemplateItems.checklistItemId,
      sortOrder: checklistTemplateItems.sortOrder,
      isRequiredOverride: checklistTemplateItems.isRequiredOverride,
      requiresPhotoOverride: checklistTemplateItems.requiresPhotoOverride,
      label: checklistItems.label,
      phase: checklistItems.phase,
      categoryName: checklistItems.categoryId,
      isRequired: checklistItems.isRequired,
      requiresPhoto: checklistItems.requiresPhoto,
    })
    .from(checklistTemplateItems)
    .innerJoin(checklistItems, eq(checklistItems.id, checklistTemplateItems.checklistItemId))
    .where(eq(checklistTemplateItems.templateId, templateId))
    // Order by the template's OWN sequence, not by phase: the wizard groups by
    // phase in the UI, so the stored order must survive a round trip (§5.3).
    .orderBy(asc(checklistTemplateItems.sortOrder), asc(checklistItems.label));

  return {
    summary,
    items: rows.map((r) => ({
      checklistItemId: r.checklistItemId,
      label: r.label,
      phase: r.phase,
      categoryName: r.categoryName,
      sortOrder: r.sortOrder,
      isRequiredOverride: r.isRequiredOverride,
      requiresPhotoOverride: r.requiresPhotoOverride,
      isRequired: r.isRequiredOverride ?? r.isRequired,
      requiresPhoto: r.requiresPhotoOverride ?? r.requiresPhoto,
    })),
  };
}

function assertCanManage(user: ActingUser, templateDivisionId: string | null): void {
  if (!canManageTemplates(user)) throw new ForbiddenError();
  // Only admin may create/edit a global template; managers stick to their divisions.
  if (templateDivisionId === null && !isAdmin(user)) {
    throw new ForbiddenError("Hanya Admin yang bisa membuat template global");
  }
  if (templateDivisionId !== null && !isAdmin(user) && !user.divisionIds.includes(templateDivisionId)) {
    throw new ForbiddenError("Kamu hanya bisa membuat template untuk divisimu");
  }
}

export async function createTemplate(
  db: DB,
  user: ActingUser,
  input: TemplateInput,
): Promise<string> {
  assertCanManage(user, input.divisionId);
  await assertItemsExistAndVisible(db, user, input.items.map((i) => i.checklistItemId));

  const id = randomUUID();
  const now = Date.now();
  await db.insert(checklistTemplates).values({
    id,
    name: input.name,
    description: input.description ?? null,
    divisionId: input.divisionId,
    createdBy: user.id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await replaceTemplateItems(db, id, input);
  await audit(db, user, "template.created", id, { name: input.name, items: input.items.length });
  return id;
}

export async function updateTemplate(
  db: DB,
  user: ActingUser,
  templateId: string,
  input: TemplateInput,
): Promise<void> {
  const existing = await db
    .select({ divisionId: checklistTemplates.divisionId })
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, templateId))
    .get();
  if (!existing) throw new ValidationError("Template tidak ditemukan");

  assertCanManage(user, existing.divisionId);
  if (existing.divisionId !== input.divisionId) {
    throw new ForbiddenError("Hanya Admin yang bisa memindahkan template antar divisi");
  }
  await assertItemsExistAndVisible(db, user, input.items.map((i) => i.checklistItemId));

  const now = Date.now();
  await db
    .update(checklistTemplates)
    .set({
      name: input.name,
      description: input.description ?? null,
      updatedAt: now,
    })
    .where(eq(checklistTemplates.id, templateId));

  await db.delete(checklistTemplateItems).where(eq(checklistTemplateItems.templateId, templateId));
  await replaceTemplateItems(db, templateId, input);
  await audit(db, user, "template.updated", templateId, { name: input.name });
}

/** Deactivation only — a template referenced by project history is never removed. */
export async function deactivateTemplate(
  db: DB,
  user: ActingUser,
  templateId: string,
): Promise<void> {
  const existing = await db
    .select({ divisionId: checklistTemplates.divisionId })
    .from(checklistTemplates)
    .where(eq(checklistTemplates.id, templateId))
    .get();
  if (!existing) throw new ValidationError("Template tidak ditemukan");
  assertCanManage(user, existing.divisionId);

  await db
    .update(checklistTemplates)
    .set({ isActive: false, updatedAt: Date.now() })
    .where(eq(checklistTemplates.id, templateId));
  await audit(db, user, "template.deactivated", templateId, {});
}

export async function duplicateTemplate(
  db: DB,
  user: ActingUser,
  templateId: string,
  newName: string,
): Promise<string> {
  const source = await getTemplate(db, user, templateId);
  if (!source) throw new ValidationError("Template tidak ditemukan");
  assertCanManage(user, source.summary.divisionId);

  const id = randomUUID();
  const now = Date.now();
  await db.insert(checklistTemplates).values({
    id,
    name: newName,
    description: source.summary.description,
    divisionId: source.summary.divisionId,
    createdBy: user.id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  if (source.items.length > 0) {
    await db.insert(checklistTemplateItems).values(
      source.items.map((it, index) => ({
        templateId: id,
        checklistItemId: it.checklistItemId,
        sortOrder: index,
        isRequiredOverride: it.isRequiredOverride,
        requiresPhotoOverride: it.requiresPhotoOverride,
      })),
    );
  }

  await audit(db, user, "template.duplicated", id, { from: templateId, name: newName });
  return id;
}

/**
 * §5.2 no.2: create a template from an existing project's checklist.
 *
 * Project checklist rows are snapshots with no link back to master unless
 * `source_item_id` is set. Custom items (no source) are promoted to new master
 * items first, marked with `source_project_id`, so the template never points at
 * a project-only row.
 *
 * Duplicates are collapsed by label+phase: a project can legitimately contain
 * the same label twice, but a template should not.
 */
export async function createTemplateFromProject(
  db: DB,
  user: ActingUser,
  input: TemplateFromProjectInput,
  opts: { projectDivisionId: string; projectName: string },
): Promise<{ templateId: string; promotedItems: number; itemCount: number }> {
  assertCanManage(user, opts.projectDivisionId);

  const snapshot = await db
    .select({
      id: projectChecklistItems.id,
      sourceItemId: projectChecklistItems.sourceItemId,
      label: projectChecklistItems.label,
      description: projectChecklistItems.description,
      phase: projectChecklistItems.phase,
      categoryName: projectChecklistItems.categoryName,
      isRequired: projectChecklistItems.isRequired,
      requiresPhoto: projectChecklistItems.requiresPhoto,
      sortOrder: projectChecklistItems.sortOrder,
      isActive: projectChecklistItems.isActive,
    })
    .from(projectChecklistItems)
    .where(eq(projectChecklistItems.projectId, input.projectId))
    .orderBy(asc(projectChecklistItems.phase), asc(projectChecklistItems.sortOrder));

  const active = snapshot.filter((s) => s.isActive);
  if (active.length === 0) {
    throw new ValidationError("Project ini tidak punya item checklist untuk dijadikan template");
  }

  const now = Date.now();
  let promotedItems = 0;

  // Resolve every snapshot row to a master item id.
  const resolved: { checklistItemId: string; sortOrder: number }[] = [];
  const seen = new Set<string>();

  for (const [index, row] of active.entries()) {
    let masterId = row.sourceItemId;

    if (!masterId) {
      // Custom project item -> promote to master.
      // Reuse an existing master item with the same label+phase if one exists,
      // so repeated "save as template" does not spam duplicates.
      const existing = await db
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .where(and(eq(checklistItems.label, row.label), eq(checklistItems.phase, row.phase)))
        .get();

      if (existing) {
        masterId = existing.id;
      } else {
        const newId = randomUUID();
        // eslint-disable-next-line no-await-in-loop
        await ensureCategoryByName(db, row.categoryName, now);
        await db.insert(checklistItems).values({
          id: newId,
          label: row.label,
          description: row.description,
          phase: row.phase,
          categoryId: await categoryIdByName(db, row.categoryName),
          divisionId: opts.projectDivisionId,
          isRequired: row.isRequired,
          requiresPhoto: row.requiresPhoto,
          sourceProjectId: input.projectId,
          isActive: true,
          sortOrder: index,
          createdBy: user.id,
          createdAt: now,
          updatedAt: now,
        });
        masterId = newId;
        promotedItems += 1;
      }
    }

    const dedupeKey = `${masterId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    resolved.push({ checklistItemId: masterId, sortOrder: resolved.length });
  }

  const templateId = randomUUID();
  await db.insert(checklistTemplates).values({
    id: templateId,
    name: input.name,
    description: input.description ?? `Dibuat dari checklist project ${opts.projectName}`,
    divisionId: opts.projectDivisionId,
    sourceProjectId: input.projectId,
    createdBy: user.id,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(checklistTemplateItems).values(
    resolved.map((r) => ({
      templateId,
      checklistItemId: r.checklistItemId,
      sortOrder: r.sortOrder,
      isRequiredOverride: null,
      requiresPhotoOverride: null,
    })),
  );

  await audit(db, user, "template.created_from_project", templateId, {
    projectId: input.projectId,
    promotedItems,
    itemCount: resolved.length,
  });

  return { templateId, promotedItems, itemCount: resolved.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function replaceTemplateItems(
  db: DB,
  templateId: string,
  input: TemplateInput,
): Promise<void> {
  // Collapse duplicate selections: the wizard merge rule (§5.3 no.1) is the same
  // invariant, so templates should not contain the same master item twice.
  const deduped = new Map<string, (typeof input.items)[number]>();
  for (const [index, item] of input.items.entries()) {
    if (!deduped.has(item.checklistItemId)) {
      deduped.set(item.checklistItemId, { ...item, sortOrder: index });
    }
  }

  if (deduped.size === 0) return;

  await db.insert(checklistTemplateItems).values(
    [...deduped.values()].map((item, index) => ({
      templateId,
      checklistItemId: item.checklistItemId,
      sortOrder: index,
      isRequiredOverride: item.isRequiredOverride,
      requiresPhotoOverride: item.requiresPhotoOverride,
    })),
  );
}

/**
 * Guards against referencing an item the user cannot see (§2.2). Without this,
 * a crafted request could attach another division's private item to a template.
 */
async function assertItemsExistAndVisible(
  db: DB,
  user: ActingUser,
  itemIds: string[],
): Promise<void> {
  if (itemIds.length === 0) return;
  const unique = [...new Set(itemIds)];

  const rows = await db
    .select({ id: checklistItems.id, divisionId: checklistItems.divisionId })
    .from(checklistItems)
    .where(inArray(checklistItems.id, unique));

  if (rows.length !== unique.length) {
    throw new ValidationError("Ada item checklist yang tidak ditemukan");
  }

  if (user.role === "admin") return;
  const notVisible = rows.find(
    (r) => r.divisionId !== null && !user.divisionIds.includes(r.divisionId),
  );
  if (notVisible) throw new ForbiddenError("Item checklist berasal dari divisi lain");
}

async function categoryIdByName(db: DB, name: string): Promise<string> {
  const row = await db
    .select({ id: checklistCategories.id })
    .from(checklistCategories)
    .where(eq(checklistCategories.name, name))
    .get();
  if (!row) throw new ValidationError(`Kategori "${name}" tidak ditemukan`);
  return row.id;
}

async function ensureCategoryByName(db: DB, name: string, now: number): Promise<void> {
  const row = await db
    .select({ id: checklistCategories.id })
    .from(checklistCategories)
    .where(eq(checklistCategories.name, name))
    .get();
  if (row) return;
  await db.insert(checklistCategories).values({
    id: randomUUID(),
    name,
    sortOrder: 999,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
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
    entityType: "checklist_template",
    entityId,
    metaJson: JSON.stringify(meta),
    ip: null,
    createdAt: Date.now(),
  });
}
