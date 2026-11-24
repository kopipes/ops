/** Admin-only removal. References (including inactive/deleted history) retain the row. */
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { REMOVAL_ENTITIES, type RemovalEntity, type RemovalPreview } from "@/lib/data-removal";
import type * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";

type DB = BetterSQLite3Database<typeof schema>;
type Reader = Pick<DB, "all" | "get" | "run">;
const targets = {
  user: { table: "users", label: "name" },
  division: { table: "divisions", label: "name" },
  checklist_item: { table: "checklist_items", label: "label" },
  checklist_category: { table: "checklist_categories", label: "name" },
  issue_category: { table: "issue_categories", label: "name" },
  template: { table: "checklist_templates", label: "name" },
  division_template: { table: "division_checklist_templates", label: "name" },
} as const;
const targetSchema = z.object({ entity: z.enum(REMOVAL_ENTITIES), id: z.string().trim().min(1).max(100) });
export const removalSchema = targetSchema.extend({
  expectedMode: z.enum(["delete", "archive"]),
  expectedVersion: z.coerce.number().int().positive().optional(),
  confirmation: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(3, "Alasan minimal 3 karakter").max(1000),
});

function requireActiveAdmin(db: Reader, actor: ActingUser) {
  if (actor.role !== "admin" || !actor.isActive) throw new ForbiddenError();
  const current = db.get<{ role: string; is_active: number; pending_approval: number; must_change_password: number }>(sql`select role, is_active, pending_approval, must_change_password from users where id=${actor.id}`);
  if (!current || current.role !== "admin" || !current.is_active || current.pending_approval || current.must_change_password) throw new ForbiddenError();
}

function preview(db: Reader, actor: ActingUser, entity: RemovalEntity, id: string): RemovalPreview {
  const target = targets[entity];
  const row = db.get<{ name: string; role?: string; is_active: number; last_login_at?: number | null; version?: number }>(sql`select *, ${sql.identifier(target.label)} as name from ${sql.identifier(target.table)} where id=${id}`);
  if (!row) throw new ValidationError("Data tidak ditemukan atau sudah dihapus");
  if (entity === "user") {
    if (id === actor.id) throw new ValidationError("Tidak bisa menghapus atau mengarsipkan akun sendiri");
    if (row.role === "admin" && row.is_active) {
      const other = db.get(sql`select id from users where role='admin' and is_active=1 and pending_approval=0 and id<>${id} limit 1`);
      if (!other) throw new ValidationError("Tidak bisa menghapus atau mengarsipkan Admin terakhir");
    }
  }

  // Discover all inbound foreign keys, so new relations fail safely as well.
  // Only owned session/membership rows and a template's own content may be removed.
  const refs = db.all<{ child_table: string; child_column: string }>(sql`
    select m.name as child_table, f."from" as child_column
    from sqlite_schema m join pragma_foreign_key_list(m.name) f
    where m.type='table' and f."table"=${target.table}`);
  let references = 0;
  for (const ref of refs) {
    if (entity === "user" && ref.child_column === "user_id" && ["sessions", "user_divisions"].includes(ref.child_table)) continue;
    if (ref.child_column === "template_id" && (
      (entity === "template" && ref.child_table === "checklist_template_items") ||
      (entity === "division_template" && ref.child_table === "division_checklist_template_items")
    )) continue;
    const count = db.get<{ n: number }>(sql`select count(*) as n from ${sql.identifier(ref.child_table)} where ${sql.identifier(ref.child_column)}=${id}`);
    references += count?.n ?? 0;
  }
  if (entity === "user" && row.last_login_at != null) references += 1;
  // Older projects keep item snapshots rather than template IDs. Preserve any
  // template whose items occur in project history, even when the project is deleted.
  if (entity === "template") {
    const count = db.get<{ n: number }>(sql`select count(*) as n from project_checklist_items p where p.source_item_id in (select checklist_item_id from checklist_template_items where template_id=${id})`);
    references += count?.n ?? 0;
    const used = db.get<{ n: number }>(sql`select count(*) as n from audit_logs where entity_type='template' and entity_id=${id} and action in ('template.used','template.legacy_retained')`);
    references += used?.n ?? 0;
  }
  return { entity, id, name: row.name, mode: references ? "archive" : "delete", references, version: row.version };
}

export function previewDataRemoval(db: DB, actor: ActingUser, entity: RemovalEntity, id: string): RemovalPreview {
  const parsed = targetSchema.safeParse({ entity, id });
  if (!parsed.success) throw new ValidationError("Data tidak valid");
  return db.transaction(tx => {
    requireActiveAdmin(tx, actor);
    return preview(tx, actor, parsed.data.entity, parsed.data.id);
  });
}

export function removeData(db: DB, actor: ActingUser, input: z.infer<typeof removalSchema>): RemovalPreview {
  const parsed = removalSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Data tidak valid");
  return db.transaction(tx => {
    requireActiveAdmin(tx, actor);
    const { entity, id, confirmation, reason, expectedMode, expectedVersion } = parsed.data;
    const current = preview(tx, actor, entity, id);
    if (confirmation !== current.name.trim()) throw new ValidationError("Nama konfirmasi tidak sesuai. Ketik nama data dengan tepat.");
    if (entity === "division_template" && expectedVersion !== current.version) {
      throw new ValidationError("Template sudah berubah. Buka ulang dialog dan periksa sebelum menghapus.");
    }
    if (expectedMode !== current.mode) throw new ValidationError("Penggunaan data berubah. Tutup dialog lalu buka kembali untuk memeriksa tindakan terbaru.");
    const target = targets[entity];
    const now = Date.now();
    const divisionId = entity === "division_template"
      ? tx.get<{ division_id: string }>(sql`select division_id from division_checklist_templates where id=${id}`)?.division_id
      : undefined;
    if (current.mode === "archive") {
      tx.run(sql`update ${sql.identifier(target.table)} set is_active=0, updated_at=${now} ${entity === "user" ? sql`, pending_approval=0` : sql``} where id=${id}`);
    } else {
      if (entity === "user") tx.run(sql`delete from user_divisions where user_id=${id}`);
      if (entity === "template") tx.run(sql`delete from checklist_template_items where template_id=${id}`);
      if (entity === "division_template") tx.run(sql`delete from division_checklist_template_items where template_id=${id}`);
      // Foreign keys remain enabled: an unknown/racing reference can never cascade.
      if (entity === "user") tx.run(sql`delete from sessions where user_id=${id}`);
      tx.run(sql`delete from ${sql.identifier(target.table)} where id=${id}`);
    }
    if (entity === "user" && current.mode === "archive") tx.run(sql`delete from sessions where user_id=${id}`);
    tx.run(sql`insert into audit_logs (id,user_id,action,entity_type,entity_id,meta_json,created_at) values (${randomUUID()},${actor.id},${`${entity}.${current.mode === "delete" ? "deleted" : "archived"}`},${entity},${id},${JSON.stringify({ name: current.name, reason, mode: current.mode, references: current.references, divisionId })},${now})`);
    return current;
  });
}

/** Restore only the master surfaces which did not previously have activation. */
export function reactivateMasterData(db: DB, actor: ActingUser, entity: RemovalEntity, id: string): void {
  if (!["template", "checklist_category", "issue_category"].includes(entity)) throw new ValidationError("Jenis data tidak valid");
  const parsed = targetSchema.safeParse({ entity, id });
  if (!parsed.success) throw new ValidationError("Data tidak valid");
  db.transaction(tx => {
    requireActiveAdmin(tx, actor);
    const target = targets[parsed.data.entity];
    const row = tx.get<{ name: string; is_active: number }>(sql`select ${sql.identifier(target.label)} as name, is_active from ${sql.identifier(target.table)} where id=${parsed.data.id}`);
    if (!row) throw new ValidationError("Data tidak ditemukan");
    if (row.is_active) return;
    const now = Date.now();
    tx.run(sql`update ${sql.identifier(target.table)} set is_active=1, updated_at=${now} where id=${parsed.data.id}`);
    tx.run(sql`insert into audit_logs (id,user_id,action,entity_type,entity_id,meta_json,created_at) values (${randomUUID()},${actor.id},${`${entity}.reactivated`},${entity},${parsed.data.id},${JSON.stringify({ name: row.name })},${now})`);
  });
}
