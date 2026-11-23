import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { PHASES, type ProjectChecklistEdit } from "@/lib/schemas";
import * as schema from "@/server/db/schema";
import { canManageProject, type ActingUser } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";
import { currentProjectAccess } from "./project-access";

type DB = BetterSQLite3Database<typeof schema>;
type EditRow = ProjectChecklistEdit["rows"][number];
type Change = {
  before: (EditRow & { sortOrder: number }) | null;
  after: (EditRow & { sortOrder: number }) | null;
};
const { auditLogs, projectChecklistItems, users } = schema;
const EDIT_ACTION = "project_checklist.edited";

export function checklistEditVersion(rows: { id: string }[]): string {
  // A change always assigns a new ID to the altered item.
  return createHash("sha256").update(JSON.stringify(rows.map((row) => row.id).sort())).digest("hex");
}

export function editProjectChecklist(db: DB, actor: ActingUser, projectId: string, edit: ProjectChecklistEdit) {
  db.transaction((tx) => {
    const { user, facts } = currentProjectAccess(tx, actor, projectId);
    if (!canManageProject(user, facts)) throw new ForbiddenError();

    const active = tx.select().from(projectChecklistItems)
      .where(and(eq(projectChecklistItems.projectId, projectId), eq(projectChecklistItems.isActive, true)))
      .orderBy(asc(projectChecklistItems.sortOrder), asc(projectChecklistItems.label), asc(projectChecklistItems.id))
      .all();
    if (checklistEditVersion(active) !== edit.version) {
      throw new ValidationError("Checklist sudah diubah. Buka ulang tab Checklist sebelum menyimpan.");
    }

    const byId = new Map(active.map((row) => [row.id, row]));
    const seen = new Set<string>();
    for (const row of edit.rows) {
      if (row.id === null) continue;
      if (!byId.has(row.id) || seen.has(row.id)) throw new ValidationError("Ada poin checklist yang tidak valid");
      seen.add(row.id);
    }

    const changes: Change[] = [];
    const now = Date.now();
    function retire(id: string) {
      tx.update(projectChecklistItems).set({ isActive: false, updatedAt: now })
        .where(eq(projectChecklistItems.id, id)).run();
    }

    for (const phase of PHASES) {
      const previous = active.filter((row) => row.phase === phase);
      const desired = edit.rows.filter((row) => row.phase === phase);
      // Keep original sort values for label-only edits. Reassign positions
      // together when the membership or ordering of a phase changes.
      const sameOrder = previous.length === desired.length && previous.every((row, i) => row.id === desired[i].id);
      for (const [index, row] of desired.entries()) {
        const old = row.id === null ? undefined : byId.get(row.id);
        const sortOrder = sameOrder && old ? old.sortOrder : index;
        if (old && old.phase === row.phase && old.label === row.label &&
            old.description === row.description && old.categoryName === row.categoryName &&
            old.isRequired === row.isRequired && old.requiresPhoto === row.requiresPhoto &&
            old.sortOrder === sortOrder) continue;

        // Reports join these item IDs for historical labels, rules and order.
        // Retire the old version and keep all of its report-facing fields.
        if (old) retire(old.id);
        const next = { ...row, id: randomUUID(), sortOrder };
        tx.insert(projectChecklistItems).values({
          ...next,
          projectId,
          sourceItemId: old?.sourceItemId ?? null,
          seriesId: old?.seriesId ?? old?.id ?? null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        }).run();
        changes.push({ before: old ? auditRow(old) : null, after: next });
      }
    }

    for (const row of active) {
      if (seen.has(row.id)) continue;
      retire(row.id);
      changes.push({ before: auditRow(row), after: null });
    }

    if (changes.length > 0) {
      tx.insert(auditLogs).values({
        id: randomUUID(),
        userId: user.id,
        action: EDIT_ACTION,
        entityType: "project",
        entityId: projectId,
        metaJson: JSON.stringify({ editorName: tx.select({ name: users.name }).from(users).where(eq(users.id, user.id)).get()?.name, changes }),
        createdAt: now,
      }).run();
    }
  }, { behavior: "immediate" });
}

function auditRow(row: EditRow & { sortOrder: number }): NonNullable<Change["before"]> {
  const { id, phase, label, description, categoryName, isRequired, requiresPhoto, sortOrder } = row;
  return { id, phase, label, description, categoryName, isRequired, requiresPhoto, sortOrder };
}

export function listProjectChecklistHistory(db: DB, projectId: string) {
  return db.select({ id: auditLogs.id, at: auditLogs.createdAt, meta: auditLogs.metaJson })
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, "project"), eq(auditLogs.entityId, projectId), eq(auditLogs.action, EDIT_ACTION)))
    .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
    .limit(20).all()
    .map(({ id, at, meta }) => {
      const { editorName, changes } = JSON.parse(meta ?? "{}") as { editorName?: string; changes: Change[] };
      return { id, at, editorName: editorName ?? "Pengguna", changes };
    });
}
