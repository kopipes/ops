import { createHash, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/server/db/schema";
import { auditLogs, divisionChecklistTemplates as templates, divisionChecklistTemplateItems as items, divisions } from "@/server/db/schema";
import {
  divisionTemplateNameSchema, divisionTemplateRowSchema, divisionTemplateRowsSchema,
  type DivisionTemplatePreview, type DivisionTemplateRow,
} from "@/lib/division-templates";
import { PHASES } from "@/lib/schemas";
import { canCreateProject, isAdmin, type ActingUser } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";
import type { ExcelChecklistRow } from "./checklist-import";
import { currentProjectActor } from "./project-access";

type DB = BetterSQLite3Database<typeof schema>;
type SavedRow = typeof items.$inferSelect;

const normalize = (value: string) => value.trim().normalize("NFKC").toLocaleLowerCase("id-ID");
const keyOf = (row: DivisionTemplateRow) => JSON.stringify([row.phase, normalize(row.label)]);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function manager(db: DB, actor: ActingUser) {
  const user = currentProjectActor(db, actor);
  if (!canCreateProject(user)) throw new ForbiddenError("Hanya Admin dan Manager yang dapat mengelola template.");
  return user;
}

function allowedDivision(user: ActingUser, divisionId: string) {
  if (!isAdmin(user) && !user.divisionIds.includes(divisionId)) throw new ForbiddenError("Template di luar divisi yang kamu kelola.");
}

function activeDivision(db: DB, user: ActingUser, divisionId: string) {
  allowedDivision(user, divisionId);
  const division = db.select().from(divisions).where(eq(divisions.id, divisionId)).get();
  if (!division?.isActive) throw new ValidationError("Pilih divisi aktif.");
  return division;
}

export function listTemplateDivisions(db: DB, actor: ActingUser) {
  const user = manager(db, actor);
  return db.select({ id: divisions.id, name: divisions.name })
    .from(divisions).where(and(eq(divisions.isActive, true),
      isAdmin(user) ? undefined : inArray(divisions.id, user.divisionIds)))
    .orderBy(asc(divisions.name)).all();
}

export function listDivisionTemplates(db: DB, actor: ActingUser, usableOnly = false) {
  const user = manager(db, actor);
  const itemCount = sql<number>`(select count(*) from ${items} where ${items.templateId} = ${templates.id})`;
  return db.select({
    id: templates.id, name: templates.name, divisionId: templates.divisionId,
    divisionName: divisions.name, isActive: templates.isActive, divisionActive: divisions.isActive, itemCount,
  }).from(templates).innerJoin(divisions, eq(templates.divisionId, divisions.id)).where(and(
    isAdmin(user) ? undefined : inArray(templates.divisionId, user.divisionIds),
    usableOnly ? and(eq(divisions.isActive, true), eq(templates.isActive, true), sql`${itemCount} > 0`) : undefined,
  )).orderBy(asc(divisions.name), asc(templates.name), asc(templates.id)).all();
}

function read(db: DB, user: ActingUser, id: string) {
  const template = db.select({ template: templates, divisionName: divisions.name, divisionActive: divisions.isActive })
    .from(templates).innerJoin(divisions, eq(templates.divisionId, divisions.id)).where(eq(templates.id, id)).get();
  if (!template) throw new ValidationError("Template tidak ditemukan.");
  allowedDivision(user, template.template.divisionId);
  const rows = db.select().from(items).where(eq(items.templateId, id))
    .orderBy(asc(items.sortOrder), asc(items.id)).all();
  return { ...template.template, divisionName: template.divisionName, divisionActive: template.divisionActive, rows };
}

export function readDivisionTemplate(db: DB, actor: ActingUser, id: string) {
  return db.transaction((tx) => read(tx, manager(tx, actor), id));
}

export function readProjectTemplate(db: DB, actor: ActingUser, id: string, divisionId: string) {
  const template = read(db, actor, id);
  if (template.divisionId !== divisionId || !template.divisionActive || !template.isActive || !template.rows.length) {
    throw new ValidationError("Pilih template aktif dari divisi owner project.");
  }
  return template;
}

function validName(db: DB, divisionId: string, name: string, excludeId?: string) {
  const parsed = divisionTemplateNameSchema.safeParse(name);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  const candidates = db.select({ id: templates.id, name: templates.name }).from(templates)
    .where(and(eq(templates.divisionId, divisionId), eq(templates.isActive, true))).all();
  if (candidates.some((candidate) => candidate.id !== excludeId && normalize(candidate.name) === normalize(parsed.data))) {
    throw new ValidationError("Sudah ada template aktif dengan nama ini di divisi tersebut.");
  }
  return parsed.data;
}

function requireVersion(current: number, expected: number) {
  if (current !== expected) throw new ValidationError("Template sudah berubah. Muat ulang halaman untuk melihat versi terbaru.");
}

function storeRows(db: DB, templateId: string, rows: DivisionTemplateRow[]) {
  db.delete(items).where(eq(items.templateId, templateId)).run();
  for (const [sortOrder, row] of rows.entries()) {
    db.insert(items).values({ ...row, categoryName: row.categoryName || "Umum", id: randomUUID(), templateId, sortOrder }).run();
  }
}

function log(db: DB, actor: ActingUser, action: string, templateId: string, meta: object) {
  db.insert(auditLogs).values({
    id: randomUUID(), userId: actor.id, action, entityType: "division_template",
    entityId: templateId, metaJson: JSON.stringify(meta), createdAt: Date.now(),
  }).run();
}

function countKeys(rows: DivisionTemplateRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
  return counts;
}

export function editDivisionTemplate(db: DB, actor: ActingUser, id: string, version: number, input: unknown, name: string) {
  const parsed = divisionTemplateRowsSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
  return db.transaction((tx) => {
    const user = manager(tx, actor);
    const current = read(tx, user, id);
    activeDivision(tx, user, current.divisionId);
    requireVersion(current.version, version);
    if (!current.isActive) throw new ValidationError("Pulihkan template sebelum mengedit.");
    const nextName = name.trim() === current.name ? current.name : validName(tx, current.divisionId, name, id);
    const before = countKeys(current.rows);
    for (const [key, count] of countKeys(parsed.data)) {
      if (count > Math.max(1, before.get(key) ?? 0)) throw new ValidationError("Nama poin dalam fase yang sama harus berbeda.");
    }
    storeRows(tx, id, parsed.data);
    tx.update(templates).set({ name: nextName, version: version + 1, updatedAt: Date.now() }).where(eq(templates.id, id)).run();
    log(tx, user, "division_template.edited", id, { points: parsed.data.length, version: version + 1 });
  }, { behavior: "immediate" });
}

export function setDivisionTemplateActive(db: DB, actor: ActingUser, id: string, version: number, isActive: boolean) {
  return db.transaction((tx) => {
    const user = manager(tx, actor);
    const current = read(tx, user, id);
    requireVersion(current.version, version);
    if (current.isActive === isActive) return;
    if (isActive) {
      activeDivision(tx, user, current.divisionId);
      if (!current.rows.length) throw new ValidationError("Template kosong tidak dapat dipulihkan.");
      validName(tx, current.divisionId, current.name, id);
    }
    tx.update(templates).set({ isActive, version: version + 1, updatedAt: Date.now() }).where(eq(templates.id, id)).run();
    log(tx, user, isActive ? "division_template.restored" : "division_template.archived", id, { version: version + 1 });
  }, { behavior: "immediate" });
}

export interface ExcelTemplateTarget {
  templateId: string;
  divisionId: string;
  name: string;
  requestId: string;
}

function flag(value: string, fallback: boolean) {
  if (!value) return fallback;
  if (["ya", "yes", "true", "1"].includes(normalize(value))) return true;
  if (["tidak", "no", "false", "0"].includes(normalize(value))) return false;
  throw new ValidationError("Kolom Wajib dan Foto wajib harus Ya atau Tidak.");
}

function parseRows(excelRows: ExcelChecklistRow[]) {
  const seen = new Set<string>();
  const entries: { row: DivisionTemplateRow; order: number; index: number }[] = [];
  const errors: DivisionTemplatePreview["rows"] = [];
  for (const excelRow of excelRows) {
    if (excelRow.sample) continue;
    const [phaseRaw, category, label, description, , required, photo, rank] = excelRow.values;
    const phase = normalize(phaseRaw);
    try {
      if (!PHASES.some((p) => p === phase)) throw new ValidationError("Gunakan Opening, Monitoring, atau Closing.");
      const parsed = divisionTemplateRowSchema.safeParse({
        phase, categoryName: category || "Umum", label, description: description || null,
        isRequired: flag(required, true), requiresPhoto: flag(photo, false),
      });
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0].message);
      const order = rank ? Number(rank) : excelRow.row - 1;
      if (!Number.isInteger(order) || order < 0 || order > 9999) throw new ValidationError("Urutan harus bilangan bulat 0–9999.");
      const key = keyOf(parsed.data);
      if (seen.has(key)) throw new ValidationError("Nama poin ini sudah ada dalam fase yang sama.");
      seen.add(key);
      entries.push({ row: parsed.data, order, index: excelRow.row });
    } catch (error) {
      if (!(error instanceof ValidationError)) throw error;
      errors.push({ number: excelRow.row, label, phase, category, error: error.message });
    }
  }
  const sorted = entries.sort((a, b) => a.order - b.order || a.index - b.index);
  return { entries: sorted, errors };
}

function rowContent(row: DivisionTemplateRow) {
  return [row.label, row.categoryName, row.description, row.isRequired, row.requiresPhoto];
}

function buildPlan(db: DB, user: ActingUser, excelRows: ExcelChecklistRow[], target: ExcelTemplateTarget) {
  const current = target.templateId ? read(db, user, target.templateId) : null;
  if (current && !current.isActive) throw new ValidationError("Pulihkan template sebelum mengganti isinya.");
  const divisionId = current?.divisionId ?? target.divisionId;
  activeDivision(db, user, divisionId);
  const name = current?.name ?? validName(db, divisionId, target.name);
  const { entries, errors } = parseRows(excelRows);
  const rows = entries.map(({ row }) => row);
  if (!errors.length && !rows.length) throw new ValidationError("File harus berisi minimal satu poin.");
  const existing = new Map<string, SavedRow[]>();
  const previousPositions = new Map<string, number>();
  const nextPositions = new Map<string, number>();
  for (const row of current?.rows ?? []) {
    const key = keyOf(row);
    existing.set(key, [...(existing.get(key) ?? []), row]);
    previousPositions.set(row.id, previousPositions.get(row.phase) ?? 0);
    previousPositions.set(row.phase, (previousPositions.get(row.phase) ?? 0) + 1);
  }
  let added = 0, changed = 0, unchanged = 0;
  for (const row of rows) {
    const old = existing.get(keyOf(row))?.shift();
    const position = nextPositions.get(row.phase) ?? 0;
    nextPositions.set(row.phase, position + 1);
    if (!old) added++;
    else if (JSON.stringify(rowContent(old)) === JSON.stringify(rowContent(row)) && previousPositions.get(old.id) === position) unchanged++;
    else changed++;
  }
  const removed = [...existing.values()].reduce((sum, remaining) => sum + remaining.length, 0);
  const preview: DivisionTemplatePreview = {
    hash: digest({ actor: user.id, divisionId, name, target, version: current?.version, rows }),
    added, changed, removed, unchanged, samples: excelRows.filter((row) => row.sample).length, total: rows.length,
    rows: [...entries.map(({ index, row }) => ({ number: index, label: row.label, phase: row.phase, category: row.categoryName })), ...errors]
      .sort((a, b) => a.number - b.number),
  };
  return { preview, rows, current, divisionId, name };
}

export function previewDivisionTemplateExcel(db: DB, actor: ActingUser, rows: ExcelChecklistRow[], target: ExcelTemplateTarget) {
  return db.transaction((tx) => buildPlan(tx, manager(tx, actor), rows, target).preview);
}

export function commitDivisionTemplateExcel(db: DB, actor: ActingUser, excelRows: ExcelChecklistRow[], target: ExcelTemplateTarget, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new ValidationError("Periksa file sebelum menyimpan.");
  const requestDigest = digest({ excelRows, target });
  return db.transaction((tx) => {
    const user = manager(tx, actor);
    const prior = tx.select({ templateId: auditLogs.entityId, meta: auditLogs.metaJson }).from(auditLogs).where(and(
      eq(auditLogs.userId, user.id), eq(auditLogs.entityType, "division_template"),
      sql`${auditLogs.action} in ('division_template.imported', 'division_template.replaced')`,
      sql`case when json_valid(${auditLogs.metaJson}) then json_extract(${auditLogs.metaJson}, '$.importHash') end = ${hash}`,
    )).get();
    if (prior && JSON.parse(prior.meta ?? "{}").requestDigest === requestDigest) {
      read(tx, user, prior.templateId);
      return prior.templateId;
    }

    const { preview, rows, current, divisionId, name } = buildPlan(tx, user, excelRows, target);
    if (preview.rows.some((row) => row.error)) throw new ValidationError("Perbaiki baris yang ditandai sebelum menyimpan.");
    if (preview.hash !== hash) throw new ValidationError("Data berubah sejak pratinjau. Periksa file kembali.");
    const id = current?.id ?? randomUUID();
    const now = Date.now();
    if (current) {
      tx.update(templates).set({ version: current.version + 1, updatedAt: now }).where(eq(templates.id, id)).run();
    } else {
      tx.insert(templates).values({ id, divisionId, name, createdBy: user.id, createdAt: now, updatedAt: now }).run();
    }
    storeRows(tx, id, rows);
    log(tx, user, current ? "division_template.replaced" : "division_template.imported", id, {
      divisionId, name, importHash: hash, requestDigest, added: preview.added, changed: preview.changed, removed: preview.removed,
    });
    return id;
  }, { behavior: "immediate" });
}

export function listUnassignedLegacyTemplates(db: DB, actor: ActingUser) {
  const user = manager(db, actor);
  if (!isAdmin(user)) throw new ForbiddenError();
  return db.all<{ id: string; name: string; itemCount: number }>(sql`
    select t.id, t.name, count(*) as itemCount
    from checklist_templates t
    join checklist_template_items i on i.template_id=t.id
    where t.division_id is null and not exists (
      select 1 from division_checklist_templates d
      where d.id=('legacy:' || t.id || ':' || d.division_id)
    ) and not exists (
      select 1 from audit_logs a
      where a.entity_type='division_template' and a.action='division_template.deleted'
      and a.entity_id=('legacy:' || t.id || ':' || case when json_valid(a.meta_json) then json_extract(a.meta_json, '$.divisionId') end)
    )
    group by t.id, t.name
    order by t.is_active desc, t.name asc
  `);
}

export function assignLegacyTemplate(db: DB, actor: ActingUser, id: string, divisionId: string, name: string) {
  return db.transaction((tx) => {
    const user = manager(tx, actor);
    if (!isAdmin(user)) throw new ForbiddenError();
    activeDivision(tx, user, divisionId);
    const original = tx.select().from(schema.checklistTemplates)
      .where(and(eq(schema.checklistTemplates.id, id), sql`${schema.checklistTemplates.divisionId} is null`)).get();
    if (!original) throw new ValidationError("Template lama tidak ditemukan.");
    const templateId = `legacy:${id}:${divisionId}`;
    if (tx.select({ id: templates.id }).from(templates).where(eq(templates.id, templateId)).get()) {
      throw new ValidationError("Template lama ini sudah disalin ke divisi tersebut.");
    }
    const removed = tx.select({ id: auditLogs.id }).from(auditLogs).where(and(
      eq(auditLogs.entityType, "division_template"), eq(auditLogs.entityId, templateId),
      eq(auditLogs.action, "division_template.deleted"),
    )).get();
    if (removed) throw new ValidationError("Salinan template ini sudah dihapus permanen.");
    const title = validName(tx, divisionId, name || original.name);
    const rows = tx.all<DivisionTemplateRow>(sql`
      select i.phase, c.name as categoryName, i.label, i.description,
        coalesce(j.is_required_override, i.is_required) as isRequired,
        coalesce(j.requires_photo_override, i.requires_photo) as requiresPhoto
      from checklist_template_items j
      join checklist_items i on i.id=j.checklist_item_id
      join checklist_categories c on c.id=i.category_id
      where j.template_id=${id}
      order by j.sort_order, i.sort_order, i.id
    `);
    if (!rows.length) throw new ValidationError("Template lama ini belum punya poin.");
    const now = Date.now();
    tx.insert(templates).values({
      id: templateId, divisionId, name: title, description: original.description,
      createdBy: user.id, createdAt: now, updatedAt: now,
    }).run();
    storeRows(tx, templateId, rows.map((row) => ({ ...row, isRequired: Boolean(row.isRequired), requiresPhoto: Boolean(row.requiresPhoto) })));
    log(tx, user, "division_template.legacy_assigned", templateId, { divisionId, legacyTemplateId: id, points: rows.length });
    return templateId;
  }, { behavior: "immediate" });
}
