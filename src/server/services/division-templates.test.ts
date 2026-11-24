import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import { projectInputSchema } from "@/lib/schemas";
import { parseChecklistWorkbook, type ExcelChecklistRow } from "./checklist-import";
import { removeData } from "./data-removal";
import { createProject } from "./projects";
import { divisionTemplateWorkbook } from "./division-template-workbook";
import {
  assignLegacyTemplate, commitDivisionTemplateExcel, editDivisionTemplate, listDivisionTemplates,
  listUnassignedLegacyTemplates, previewDivisionTemplateExcel,
  readDivisionTemplate, setDivisionTemplateActive,
} from "./division-templates";

let raw: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

const manager: ActingUser = { id: "mgr", role: "manager", isActive: true, divisionIds: ["d1"] };
const admin: ActingUser = { id: "admin", role: "admin", isActive: true, divisionIds: [] };
const crew: ActingUser = { id: "crew", role: "user", isActive: true, divisionIds: ["d1"] };
const points: ExcelChecklistRow[] = [
  { row: 2, values: ["Opening", "Area", "Pintu masuk", "Periksa panel", "Global", "Ya", "Ya", "1"] },
  { row: 3, values: ["Closing", "Area", "Lampu luar", "", "", "Ya", "Tidak", "2"] },
];
const target = (templateId = "", divisionId = "d1", name = "Venue Malam") => ({
  templateId, divisionId, name, requestId: randomUUID(),
});

function upload(actor = manager, rows = points, destination = target()) {
  const preview = previewDivisionTemplateExcel(db, actor, rows, destination);
  return commitDivisionTemplateExcel(db, actor, rows, destination, preview.hash);
}

function project(templateId: string, division = "d1", code = "SNAP-1") {
  return projectInputSchema.parse({
    code, name: "Project Snapshot", venue: "Lokasi", ownerDivisionId: division,
    startDate: "2026-11-24", endDate: "2026-11-24", timezone: "Asia/Jakarta",
    openingWindowStart: "06:00", openingWindowEnd: "11:00",
    closingWindowStart: "17:00", closingWindowEnd: "23:59",
    templateIds: [templateId], checklistSource: "template",
  });
}

const snapshotOptions = (templateVersion: number) => ({ templateVersion, removedTemplateRows: [], copiedRows: [] });

beforeEach(() => {
  raw = new Database(":memory:");
  raw.pragma("foreign_keys=ON");
  db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: "src/server/db/migrations" });
  raw.exec(`
    insert into divisions (id,code,name,created_at,updated_at) values ('d1','D1','Divisi 1',1,1),('d2','D2','Divisi 2',1,1);
    insert into users (id,name,email,password_hash,role,created_at,updated_at) values
     ('admin','Admin','a@x','h','admin',1,1),('mgr','Manager','m@x','h','manager',1,1),('crew','Crew','c@x','h','user',1,1);
    insert into user_divisions (user_id,division_id) values ('mgr','d1'),('crew','d1');
  `);
});
afterEach(() => raw.close());

it("scopes list, read, Excel creation and replacement to current division access", () => {
  const mine = upload();
  const other = upload(admin, points, target("", "d2"));
  expect(listDivisionTemplates(db, manager).map((row) => row.id)).toEqual([mine]);
  expect(() => listDivisionTemplates(db, crew)).toThrow();
  expect(() => readDivisionTemplate(db, manager, other)).toThrow();
  expect(() => upload(manager, points, target(other))).toThrow();
  expect(() => upload(manager, points, target("", "d2"))).toThrow();
  expect(() => upload(admin, points, target("", ""))).toThrow();
  const destination = target(mine);
  const preview = previewDivisionTemplateExcel(db, manager, points, destination);
  raw.exec("delete from user_divisions where user_id='mgr'");
  expect(() => commitDivisionTemplateExcel(db, manager, points, destination, preview.hash)).toThrow();
});

it("handles sample, template-local duplicates, replay, replacement diff and stale preview", () => {
  const destination = target();
  const withExample = [{ ...points[0], row: 5, sample: true }, ...points];
  const first = previewDivisionTemplateExcel(db, manager, withExample, destination);
  expect(first).toMatchObject({ added: 2, samples: 1, total: 2 });
  const id = commitDivisionTemplateExcel(db, manager, withExample, destination, first.hash);
  expect(commitDivisionTemplateExcel(db, manager, withExample, destination, first.hash)).toBe(id);
  expect(upload(manager, points, target("", "d1", "Venue Kedua"))).not.toBe(id);
  const duplicate = previewDivisionTemplateExcel(db, manager, [...points, { ...points[0], row: 4 }], target(id));
  expect(duplicate.rows[2].error).toMatch(/fase yang sama/);
  expect(raw.prepare("select count(*) n from checklist_items").get()).toEqual({ n: 0 });
  const [opening] = points;
  const updated = [{ ...opening, values: opening.values.map((value, index) => index === 3 ? "Cek pintu" : value) }];
  const replacement = target(id);
  const preview = previewDivisionTemplateExcel(db, manager, updated, replacement);
  expect(preview).toMatchObject({ added: 0, changed: 1, removed: 1, unchanged: 0 });
  expect(commitDivisionTemplateExcel(db, manager, updated, replacement, preview.hash)).toBe(id);
  const saved = readDivisionTemplate(db, manager, id);
  expect(saved).toMatchObject({ divisionId: "d1", name: destination.name, version: 2 });
  expect(saved.rows).toMatchObject([{ label: "Pintu masuk", description: "Cek pintu", requiresPhoto: true }]);
  const stale = previewDivisionTemplateExcel(db, manager, points, replacement);
  editDivisionTemplate(db, manager, id, 2, saved.rows, "Venue Baru");
  expect(() => commitDivisionTemplateExcel(db, manager, points, replacement, stale.hash)).toThrow(/sejak pratinjau/);
});

it("archives and restores a template while old project snapshots and flags stay independent", async () => {
  const templateId = upload();
  await expect(createProject(db, admin, project(templateId, "d2"), snapshotOptions(1))).rejects.toThrow(/divisi owner/);
  await expect(createProject(db, manager, project(templateId), snapshotOptions(42))).rejects.toThrow(/Template berubah/);
  const created = await createProject(db, manager, project(templateId), snapshotOptions(1));
  const audit = raw.prepare("select action from audit_logs where entity_id = ? and action='template.used'").get(templateId);
  expect(audit).toEqual({ action: "template.used" });
  const saved = readDivisionTemplate(db, manager, templateId);
  editDivisionTemplate(db, manager, templateId, 1, [{ ...saved.rows[0], label: "Pintu lainnya" }], saved.name);
  setDivisionTemplateActive(db, manager, templateId, 2, false);
  expect(listDivisionTemplates(db, manager, true)).toHaveLength(0);
  await expect(createProject(db, manager, project(templateId, "d1", "SNAP-2"), snapshotOptions(3))).rejects.toThrow();
  expect(raw.prepare("select label,description,requires_photo,source_item_id from project_checklist_items where project_id=? order by sort_order").all(created.projectId))
    .toEqual([
      { label: "Pintu masuk", description: "Periksa panel", requires_photo: 1, source_item_id: null },
      { label: "Lampu luar", description: null, requires_photo: 0, source_item_id: null },
    ]);
  expect(raw.prepare("select count(*) n from projects").get()).toEqual({ n: 1 });
  setDivisionTemplateActive(db, manager, templateId, 3, true);
  expect(listDivisionTemplates(db, manager, true)).toMatchObject([{ id: templateId, itemCount: 1 }]);
});

it.each([false, true])("deletes the template and preserves its submitted reports (archived=%s)", async (archived) => {
  const templateId = upload();
  const { projectId } = await createProject(db, manager, project(templateId), snapshotOptions(1));
  raw.prepare(`
    insert into reports (id,project_id,project_day_id,phase,submitted_by,client_submission_id,status,observed_at,created_at,updated_at)
    select 'report',project_id,id,'opening','mgr','submission','submitted',1,1,1 from project_days where project_id=?
  `).run(projectId);
  raw.prepare(`
    insert into report_check_results (id,report_id,project_checklist_item_id,result,created_at)
    select 'result','report',id,'ok',1 from project_checklist_items where project_id=? and phase='opening'
  `).run(projectId);
  if (archived) setDivisionTemplateActive(db, manager, templateId, 1, false);
  const template = readDivisionTemplate(db, admin, templateId);
  removeData(db, admin, {
    entity: "division_template", id: templateId, expectedMode: "delete", expectedVersion: template.version,
    confirmation: template.name, reason: "Pembersihan template",
  });
  expect(listDivisionTemplates(db, admin)).toHaveLength(0);
  expect(raw.prepare("select count(*) n from division_checklist_template_items").get()).toEqual({ n: 0 });
  expect(raw.prepare("select status from reports where id='report'").get()).toEqual({ status: "submitted" });
  expect(raw.prepare("select r.result, i.label from report_check_results r join project_checklist_items i on i.id=r.project_checklist_item_id").get())
    .toEqual({ result: "ok", label: "Pintu masuk" });
  expect(raw.prepare("select action from audit_logs where entity_id=? and action='template.used'").get(templateId))
    .toEqual({ action: "template.used" });
  await expect(createProject(db, admin, project(templateId, "d1", "AFTER-DELETE"), snapshotOptions(1))).rejects.toThrow(/tidak ditemukan/);
  expect(raw.pragma("foreign_key_check")).toEqual([]);
});

it("exports a sample and an existing template in the supported Excel layout", async () => {
  await expect(parseChecklistWorkbook(Buffer.from(await divisionTemplateWorkbook()))).rejects.toThrow(/CONTOH/);
  const saved = readDivisionTemplate(db, manager, upload());
  const bytes = await divisionTemplateWorkbook(saved.rows);
  const data = await parseChecklistWorkbook(Buffer.from(bytes));
  expect(data.map((row) => row.values)).toEqual(points.map((row) => row.values.map((v, index) => index === 4 ? "" : v)));
});

it("migrates used Global templates only to evidence-backed divisions and preserves overrides and legacy rows", async () => {
  const { projectId } = await createProject(db, manager, { ...project("unused"), checklistSource: "empty", templateIds: [] });
  raw.exec(`
    drop table division_checklist_template_items;
    drop table division_checklist_templates;
    insert into checklist_categories(id,name,created_at,updated_at) values ('cat','Venue',1,1);
    insert into checklist_items(id, phase, category_id, label,description,is_required,requires_photo,created_at,updated_at)
      values ('point','opening','cat','Gerbang', 'Cek lampu',1,0,1,1);
    insert into checklist_templates (id,name,division_id,is_active,created_at,updated_at) values
      ('scoped','Template Divisi','d2',0,1,1),('used','Dulu Global',null,1,1,1),('unused','Global tidak terpakai',null,1,1,1);
    insert into checklist_template_items (template_id,checklist_item_id,is_required_override,requires_photo_override)
      values ('scoped','point',0,1),('used','point',0,1),('unused','point',0,1);
  `);
  raw.prepare("insert into audit_logs (id,action,entity_type,entity_id,meta_json,created_at) values ('used-log','template.used','template','used',?,1)")
    .run(JSON.stringify({ projectId }));
  raw.exec(readFileSync("src/server/db/migrations/0010_division_checklist_templates.sql", "utf8"));
  expect(listDivisionTemplates(db, admin)).toMatchObject([
    { id: "legacy:used:d1", divisionId: "d1", isActive: true }, { id: "scoped", divisionId: "d2", isActive: false },
  ]);
  expect(readDivisionTemplate(db, admin, "scoped").rows).toMatchObject([
    { categoryName: "Venue", description: "Cek lampu", isRequired: false, requiresPhoto: true },
  ]);
  expect(listUnassignedLegacyTemplates(db, admin)).toEqual([{ id: "unused", name: "Global tidak terpakai", itemCount: 1 }]);
  expect(() => assignLegacyTemplate(db, manager, "unused", "d1", "")).toThrow();
  const assigned = assignLegacyTemplate(db, admin, "unused", "d1", "");
  expect(readDivisionTemplate(db, manager, assigned).rows).toMatchObject([{ label: "Gerbang", requiresPhoto: true }]);
  expect(listUnassignedLegacyTemplates(db, admin)).toHaveLength(0);
  removeData(db, admin, {
    entity: "division_template", id: assigned, expectedMode: "delete", expectedVersion: 1,
    confirmation: "Global tidak terpakai", reason: "Pembersihan template",
  });
  expect(listUnassignedLegacyTemplates(db, admin)).toHaveLength(0);
  expect(() => assignLegacyTemplate(db, admin, "unused", "d1", "")).toThrow(/dihapus permanen/);
  expect(raw.prepare("select count(*) n from checklist_templates").get()).toEqual({ n: 3 });
  expect(raw.pragma("foreign_key_check")).toEqual([]);
});
