/**
 * Project checklist snapshot (§5.3 no.4) and the "living checklist" rules
 * (nav §5.3 no.5).
 *
 * Critical invariant, enforced by `syncProjectChecklist`:
 *   changing a project's checklist must NOT alter reports that were already
 *   submitted. Because `report_check_results` references
 *   `project_checklist_items.id`, we never delete a row that has results —
 *   we deactivate it and append new rows instead. A submitted report therefore
 *   keeps pointing at exactly the items it was filled against.
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  auditLogs,
  checklistCategories,
  checklistItems,
  checklistTemplateItems,
  projectChecklistItems,
  reportCheckResults,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";

type DB = BetterSQLite3Database<typeof schema>;

export interface SnapshotRow {
  id: string;
  projectId: string;
  sourceItemId: string | null;
  phase: "opening" | "monitoring" | "closing";
  categoryName: string;
  label: string;
  description: string | null;
  isRequired: boolean;
  requiresPhoto: boolean;
  sortOrder: number;
  isActive: boolean;
}

/**
 * §5.3 no.1: merge multiple templates into one list without duplicates.
 * Duplicate identity is the master item id; ordering follows first appearance.
 */
export async function buildChecklistFromTemplates(
  db: DB,
  templateIds: string[],
): Promise<Omit<SnapshotRow, "id" | "projectId">[]> {
  if (templateIds.length === 0) return [];

  const rows = await db
    .select({
      templateId: checklistTemplateItems.templateId,
      sourceItemId: checklistTemplateItems.checklistItemId,
      sortOrder: checklistTemplateItems.sortOrder,
      isRequiredOverride: checklistTemplateItems.isRequiredOverride,
      requiresPhotoOverride: checklistTemplateItems.requiresPhotoOverride,
      label: checklistItems.label,
      description: checklistItems.description,
      phase: checklistItems.phase,
      categoryId: checklistItems.categoryId,
      categoryName: sql<string>`coalesce(
        (select c.name from checklist_categories c where c.id = ${checklistItems.categoryId}), ''
      )`,
      isRequired: checklistItems.isRequired,
      requiresPhoto: checklistItems.requiresPhoto,
    })
    .from(checklistTemplateItems)
    .innerJoin(checklistItems, eq(checklistItems.id, checklistTemplateItems.checklistItemId))
    .where(inArray(checklistTemplateItems.templateId, templateIds))
    .orderBy(asc(checklistTemplateItems.templateId), asc(checklistTemplateItems.sortOrder));

  // Preserve the order of the templates the manager selected, not the db order.
  const ordered = templateIds.flatMap((tid) => rows.filter((r) => r.templateId === tid));

  const seen = new Set<string>();
  const out: Omit<SnapshotRow, "id" | "projectId">[] = [];

  for (const r of ordered) {
    if (seen.has(r.sourceItemId)) continue; // merge without duplicates
    seen.add(r.sourceItemId);
    out.push({
      sourceItemId: r.sourceItemId,
      phase: r.phase,
      categoryName: r.categoryName,
      label: r.label,
      description: r.description,
      isRequired: r.isRequiredOverride ?? r.isRequired,
      requiresPhoto: r.requiresPhotoOverride ?? r.requiresPhoto,
      sortOrder: out.length,
      isActive: true,
    });
  }

  return out;
}

/** §5.3 no.1: copy a previous project's checklist. */
export async function buildChecklistFromProject(
  db: DB,
  sourceProjectId: string,
): Promise<Omit<SnapshotRow, "id" | "projectId">[]> {
  const rows = await db
    .select()
    .from(projectChecklistItems)
    .where(
      and(
        eq(projectChecklistItems.projectId, sourceProjectId),
        eq(projectChecklistItems.isActive, true),
      ),
    )
    .orderBy(asc(projectChecklistItems.phase), asc(projectChecklistItems.sortOrder));

  const seen = new Set<string>();
  const out: Omit<SnapshotRow, "id" | "projectId">[] = [];

  for (const r of rows) {
    // Deduplicate by master item when present, otherwise by label+phase.
    const key = r.sourceItemId ?? `${r.phase}::${r.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceItemId: r.sourceItemId,
      phase: r.phase,
      categoryName: r.categoryName,
      label: r.label,
      description: r.description,
      isRequired: r.isRequired,
      requiresPhoto: r.requiresPhoto,
      sortOrder: out.length,
      isActive: true,
    });
  }
  return out;
}

export interface SyncChecklistInput {
  rows: Omit<SnapshotRow, "id" | "projectId">[];
  /** §5.3 no.3: persist custom items (no sourceItemId) into the master list. */
  saveCustomToMaster?: boolean;
  actor: ActingUser;
  divisionId: string;
}

export interface SyncChecklistResult {
  inserted: number;
  deactivated: number;
  reactivated: number;
  keptFrozen: number;
}

/**
 * Reconciles a project's checklist with the desired rows.
 *
 * - Existing rows are matched by `sourceItemId` (master-backed) or by
 *   phase+label (custom rows).
 * - Rows no longer wanted are DEACTIVATED, never deleted.
 * - A row referenced by any report_check_results is "frozen": it stays active
 *   so the submitted report's percentages and rendering remain correct.
 */
export async function syncProjectChecklist(
  db: DB,
  projectId: string,
  input: SyncChecklistInput,
): Promise<SyncChecklistResult> {
  const existing = await db
    .select()
    .from(projectChecklistItems)
    .where(eq(projectChecklistItems.projectId, projectId));

  const bySource = new Map<string, typeof existing>();
  for (const row of existing) {
    const key = row.sourceItemId ?? `custom::${row.phase}::${row.label}`;
    const list = bySource.get(key) ?? [];
    list.push(row);
    bySource.set(key, list);
  }

  const now = Date.now();
  const result: SyncChecklistResult = {
    inserted: 0,
    deactivated: 0,
    reactivated: 0,
    keptFrozen: 0,
  };

  /**
   * Collapse duplicates FIRST.
   *
   * A project can legitimately end up with two active rows sharing a
   * `source_item_id` (an item added by hand and then also pulled in by a
   * template, or two custom items that later converge on the same master item).
   * Without this pass, `bySource` would only ever match the first row and every
   * later sync would leave the strays active — and reports then render each
   * checklist item twice.
   *
   * The lowest sortOrder wins; the rest are deactivated (never deleted) so any
   * submitted results that reference them stay intact.
   */
  for (const [, list] of bySource) {
    if (list.length <= 1) continue;
    const sorted = [...list].sort(
      (a, b) => Number(a.sortOrder) - Number(b.sortOrder) || a.id.localeCompare(b.id),
    );
    for (const extra of sorted.slice(1)) {
      if (!extra.isActive) continue;
      await db
        .update(projectChecklistItems)
        .set({ isActive: false, updatedAt: now })
        .where(eq(projectChecklistItems.id, extra.id));
      result.deactivated += 1;
    }
  }

  // Rebuild the index from post-collapse state so the match step is accurate.
  for (const [, list] of bySource) {
    const active = list.filter((r) => r.isActive);
    if (list.length > 1) list.splice(0, list.length, ...(active.length > 0 ? active : list));
  }

  const wantedKeys = new Set<string>();
  const toInsert: (Omit<SnapshotRow, "id" | "projectId"> & { sourceItemId: string | null })[] = [];

  for (const [index, row] of input.rows.entries()) {
    const key = row.sourceItemId ?? `custom::${row.phase}::${row.label}`;
    wantedKeys.add(key);
    const match = bySource.get(key)?.[0];

    if (!match) {
      toInsert.push({ ...row, sortOrder: index });
      continue;
    }

    // Update the editable fields in place (keeps the id -> old reports intact).
    if (
      match.label !== row.label ||
      match.description !== row.description ||
      match.categoryName !== row.categoryName ||
      match.isRequired !== row.isRequired ||
      match.requiresPhoto !== row.requiresPhoto ||
      match.sortOrder !== index ||
      !match.isActive
    ) {
      await db
        .update(projectChecklistItems)
        .set({
          label: row.label,
          description: row.description,
          categoryName: row.categoryName,
          isRequired: row.isRequired,
          requiresPhoto: row.requiresPhoto,
          sortOrder: index,
          isActive: true,
          updatedAt: now,
        })
        .where(eq(projectChecklistItems.id, match.id));
      if (!match.isActive) result.reactivated += 1;
    }
  }

  // Custom items promoted to master (§5.3 no.3).
  if (input.saveCustomToMaster) {
    for (const row of toInsert) {
      if (row.sourceItemId) continue;
      const masterId = await upsertMasterItem(db, input.actor, {
        label: row.label,
        description: row.description,
        phase: row.phase,
        categoryName: row.categoryName,
        isRequired: row.isRequired,
        requiresPhoto: row.requiresPhoto,
        divisionId: input.divisionId,
        sourceProjectId: projectId,
      });
      row.sourceItemId = masterId;
    }
  }

  if (toInsert.length > 0) {
    await db.insert(projectChecklistItems).values(
      toInsert.map((r) => ({
        id: randomUUID(),
        projectId,
        sourceItemId: r.sourceItemId,
        phase: r.phase,
        categoryName: r.categoryName,
        label: r.label,
        description: r.description,
        isRequired: r.isRequired,
        requiresPhoto: r.requiresPhoto,
        sortOrder: r.sortOrder,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })),
    );
    result.inserted += toInsert.length;
  }

  // Deactivate the rows that are no longer wanted.
  for (const row of existing) {
    const key = row.sourceItemId ?? `custom::${row.phase}::${row.label}`;
    if (wantedKeys.has(key)) continue;
    if (!row.isActive) continue;

    if (await isFrozenBySubmittedReport(db, row.id)) {
      result.keptFrozen += 1;
      continue; // leave active so the submitted report stays intact
    }

    await db
      .update(projectChecklistItems)
      .set({ isActive: false, updatedAt: now })
      .where(eq(projectChecklistItems.id, row.id));
    result.deactivated += 1;
  }

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: input.actor.id,
    action: "project_checklist.synced",
    entityType: "project",
    entityId: projectId,
    metaJson: JSON.stringify(result),
    ip: null,
    createdAt: now,
  });

  return result;
}

/** True when any report_check_results row references this checklist item. */
export async function isFrozenBySubmittedReport(
  db: DB,
  projectChecklistItemId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: reportCheckResults.id })
    .from(reportCheckResults)
    .where(eq(reportCheckResults.projectChecklistItemId, projectChecklistItemId))
    .limit(1);
  return rows.length > 0;
}

async function upsertMasterItem(
  db: DB,
  actor: ActingUser,
  input: {
    label: string;
    description: string | null;
    phase: "opening" | "monitoring" | "closing";
    categoryName: string;
    isRequired: boolean;
    requiresPhoto: boolean;
    divisionId: string;
    sourceProjectId: string;
  },
): Promise<string> {
  // Reuse an existing master item with the same label+phase (any division) to
  // avoid duplicate master rows when several projects use the same custom item.
  const existing = await db
    .select({ id: checklistItems.id })
    .from(checklistItems)
    .where(and(eq(checklistItems.label, input.label), eq(checklistItems.phase, input.phase)))
    .get();
  if (existing) return existing.id;

  const categoryId = await ensureCategory(db, input.categoryName);
  const id = randomUUID();
  const now = Date.now();

  await db.insert(checklistItems).values({
    id,
    label: input.label,
    description: input.description,
    phase: input.phase,
    categoryId,
    divisionId: input.divisionId,
    isRequired: input.isRequired,
    requiresPhoto: input.requiresPhoto,
    sourceProjectId: input.sourceProjectId,
    isActive: true,
    sortOrder: 999,
    createdBy: actor.id,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function ensureCategory(db: DB, name: string): Promise<string> {
  const row = await db
    .select({ id: checklistCategories.id })
    .from(checklistCategories)
    .where(eq(checklistCategories.name, name))
    .get();
  if (row) return row.id;

  const id = randomUUID();
  const now = Date.now();
  await db.insert(checklistCategories).values({
    id,
    name,
    sortOrder: 500,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** Active snapshot rows for a project, grouped-ready and ordered. */
export async function listProjectChecklist(
  db: DB,
  projectId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<SnapshotRow[]> {
  const conditions = [eq(projectChecklistItems.projectId, projectId)];
  if (!opts.includeInactive) conditions.push(eq(projectChecklistItems.isActive, true));

  const rows = await db
    .select()
    .from(projectChecklistItems)
    .where(and(...conditions))
    .orderBy(asc(projectChecklistItems.sortOrder), asc(projectChecklistItems.label));

  return rows as SnapshotRow[];
}

/**
 * §14 AC / §5.3 no.5 check helper: how many submitted results reference this
 * project's checklist. Used by tests and by the UI warning before edits.
 */
export async function countSubmittedResults(db: DB, projectId: string): Promise<number> {
  const rows = await db
    .select({ id: reportCheckResults.id })
    .from(reportCheckResults)
    .innerJoin(
      projectChecklistItems,
      eq(projectChecklistItems.id, reportCheckResults.projectChecklistItemId),
    )
    .where(eq(projectChecklistItems.projectId, projectId));
  return rows.length;
}
