import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import { REMOVAL_ENTITIES, type RemovalEntity } from "@/lib/data-removal";
import { previewDataRemoval, reactivateMasterData, removeData } from "./data-removal";
import { recordTemplateUsage } from "./templates";

let raw: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const admin: ActingUser = { id: "admin", role: "admin", isActive: true, divisionIds: ["base"] };
const names = { user: "Unused user", division: "Unused division", checklist_item: "Unused item", checklist_category: "Unused category", issue_category: "Unused issue category", template: "Unused template" };
const tables = { user: "users", division: "divisions", checklist_item: "checklist_items", checklist_category: "checklist_categories", issue_category: "issue_categories", template: "checklist_templates" };
function remove(entity: RemovalEntity, expectedMode: "delete" | "archive" = "delete") {
  return removeData(db, admin, { entity, id: entity, confirmation: names[entity], reason: "Cleanup requested", expectedMode });
}
function project(over: Record<string, unknown> = {}) {
  raw.prepare("insert into projects (id,code,name,venue,start_date,end_date,owner_division_id,created_by,created_at,updated_at) values (?,?,?,?,?,?,?,?,1,1)").run(over.id ?? "project", over.code ?? "P1", "Historical project", "Venue", "2026-11-18", "2026-11-18", over.division ?? "base", over.user ?? "admin");
}
function row(entity: RemovalEntity) { return raw.prepare(`select * from ${tables[entity]} where id=?`).get(entity) as Record<string, unknown> | undefined; }
beforeEach(() => {
  raw = new Database(":memory:");raw.pragma("foreign_keys=ON");db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: resolve("src/server/db/migrations") });
  raw.exec(`insert into divisions (id,code,name,created_at,updated_at) values ('base','BASE','Base',1,1),('division','UNUSED','Unused division',1,1);
    insert into users (id,name,email,password_hash,role,primary_division_id,created_at,updated_at) values
    ('admin','Admin','admin@test','hash','admin','base',1,1),('manager','Manager','manager@test','hash','manager','base',1,1),('user','Unused user','unused@test','hash','user','base',1,1);
    insert into checklist_categories (id,name,created_at,updated_at) values ('base-category','Base category',1,1),('checklist_category','Unused category',1,1);
    insert into issue_categories (id,name,created_at,updated_at) values ('issue_category','Unused issue category',1,1);
    insert into checklist_items (id,label,phase,category_id,created_at,updated_at) values ('checklist_item','Unused item','opening','base-category',1,1);
    insert into checklist_templates (id,name,created_at,updated_at) values ('template','Unused template',1,1);`);
});
afterEach(() => raw.close());

describe("Admin data removal", () => {
  it.each(REMOVAL_ENTITIES)("deletes only an unused %s and preserves an audit snapshot", entity => {
    expect(previewDataRemoval(db, admin, entity, entity).mode).toBe("delete");
    expect(remove(entity).mode).toBe("delete");expect(row(entity)).toBeUndefined();
    const log = raw.prepare('select * from audit_logs where entity_id=?').get(entity) as {action:string;meta_json:string};
    expect(log.action).toBe(`${entity}.deleted`);expect(JSON.parse(log.meta_json)).toMatchObject({name:names[entity],reason:"Cleanup requested",mode:"delete"});
    expect(raw.pragma("foreign_key_check")).toEqual([]);
  });
  it.each(REMOVAL_ENTITIES)("rejects Manager preview and mutation for %s", entity => {
    const manager: ActingUser = {id:"manager",role:"manager",isActive:true,divisionIds:["base"]};
    expect(()=>previewDataRemoval(db,manager,entity,entity)).toThrow(/akses/i);
    expect(()=>removeData(db,manager,{entity,id:entity,confirmation:names[entity],reason:"Cleanup",expectedMode:"delete"})).toThrow(/akses/i);
    expect(row(entity)).toBeDefined();
  });
  it.each(["user", "corporate", "manager"] as const)("rejects %s even with fabricated Admin identity", role => {
    raw.prepare('update users set role=? where id=?').run(role,"manager");
    expect(()=>previewDataRemoval(db,{...admin,id:"manager"},"division","division")).toThrow();
  });
  it.each(["is_active=0", "pending_approval=1", "must_change_password=1", "role='manager'"])("checks fresh Admin state: %s", change => {
    raw.exec(`update users set ${change} where id='admin'`);
    expect(()=>previewDataRemoval(db,admin,"division","division")).toThrow();expect(()=>remove("division")).toThrow();
  });
  it("protects self/last Admin and does not revoke own session", () => {
    expect(()=>previewDataRemoval(db,admin,"user","admin")).toThrow(/sendiri/);
    expect(()=>removeData(db,admin,{entity:"user",id:"admin",confirmation:"Admin",reason:"Cleanup",expectedMode:"delete"})).toThrow(/sendiri/);
    expect(raw.prepare("select count(*) as n from users where role='admin' and is_active=1").get()).toEqual({n:1});
  });
  it("cleans owned memberships/sessions when deleting an unused user", () => {
    raw.exec("insert into user_divisions (user_id,division_id,is_primary) values ('user','base',1); insert into sessions (id,user_id,expires_at,created_at) values ('session','user',9999999999999,1)");
    remove("user");expect(raw.prepare("select * from sessions").all()).toEqual([]);expect(raw.prepare("select * from user_divisions").all()).toEqual([]);
  });
  it("archives a used user, removes sessions/pending flag, preserves author and memberships", () => {
    project({user:"user"});raw.exec("update users set pending_approval=1 where id='user'; insert into user_divisions (user_id,division_id,is_primary) values ('user','base',1); insert into sessions (id,user_id,expires_at,created_at) values ('session','user',9999999999999,1)");
    expect(remove("user","archive").references).toBeGreaterThan(0);expect(row("user")).toMatchObject({is_active:0,pending_approval:0});
    expect(raw.prepare("select created_by from projects").get()).toEqual({created_by:"user"});expect(raw.prepare("select * from sessions").all()).toEqual([]);expect(raw.prepare("select * from user_divisions").all()).toHaveLength(1);
  });
  it("archives previously logged-in users even without domain references", () => {
    raw.exec("update users set last_login_at=10 where id='user'");expect(remove("user","archive").mode).toBe("archive");
  });
  it("preserves divisions referenced by deleted projects", () => {
    project({division:"division"});raw.exec("update projects set deleted_at=100 where id='project'");
    remove("division","archive");expect(row("division")).toMatchObject({is_active:0});expect(raw.prepare("select owner_division_id from projects").get()).toEqual({owner_division_id:"division"});
  });
  it("preserves categories referenced by inactive master items", () => {
    raw.exec("update checklist_items set category_id='checklist_category', is_active=0");remove("checklist_category","archive");expect(row("checklist_category")).toMatchObject({is_active:0});expect(row("checklist_item")).toBeDefined();
  });
  it("preserves checklist items in inactive templates", () => {
    raw.exec("insert into checklist_template_items (template_id,checklist_item_id) values ('template','checklist_item'); update checklist_templates set is_active=0");
    remove("checklist_item","archive");expect(row("checklist_item")).toMatchObject({is_active:0});expect(raw.prepare("select * from checklist_template_items").all()).toHaveLength(1);
  });
  it("preserves issue categories linked to historical issues", () => {
    project();raw.exec("insert into issues (id,code,project_id,category_id,title,severity,next_step,author_name,author_role,created_at,updated_at) values ('issue','ISS-1','project','issue_category','Old issue','low','Check','Admin','admin',1,1)");
    remove("issue_category","archive");expect(row("issue_category")).toMatchObject({is_active:0});expect(raw.prepare("select * from issues").all()).toHaveLength(1);
  });
  it("deletes unused template content without deleting shared master items", () => {
    raw.exec("insert into checklist_template_items (template_id,checklist_item_id) values ('template','checklist_item')");remove("template");expect(raw.prepare("select * from checklist_template_items").all()).toEqual([]);expect(row("checklist_item")).toBeDefined();
  });
  it("preserves templates whose items occur in project snapshots", () => {
    project();raw.exec("insert into checklist_template_items (template_id,checklist_item_id) values ('template','checklist_item'); insert into project_checklist_items (id,project_id,source_item_id,phase,category_name,label,created_at,updated_at) values ('snapshot','project','checklist_item','opening','Category','Old label',1,1)");
    remove("template","archive");expect(row("template")).toMatchObject({is_active:0});expect(raw.prepare("select label from project_checklist_items").get()).toEqual({label:"Old label"});
  });
  it("retains historical templates after a migration even if all their items changed", () => {
    raw.exec(readFileSync(resolve("src/server/db/migrations/0004_template_removal_history.sql"), "utf8"));
    expect(remove("template", "archive").mode).toBe("archive");
  });
  it("retains templates applied to existing projects after their items are replaced", () => {
    project();recordTemplateUsage(db, admin, "project", ["template"]);
    raw.exec("delete from checklist_template_items where template_id='template'");
    expect(remove("template", "archive").mode).toBe("archive");
  });
  it.each(["template", "checklist_category", "issue_category"] as const)("reactivates %s with an atomic audit", entity => {
    raw.exec(`update ${tables[entity]} set is_active=0 where id='${entity}'`);
    reactivateMasterData(db, admin, entity, entity);expect(row(entity)).toMatchObject({is_active:1});
    expect(raw.prepare("select action from audit_logs where entity_id=?").get(entity)).toEqual({action:`${entity}.reactivated`});
  });
  it("requires fresh Admin privileges for reactivation and never bypasses user activation rules", () => {
    expect(()=>reactivateMasterData(db,{...admin,id:"manager"},"template","template")).toThrow();
    expect(()=>reactivateMasterData(db,admin,"user","user")).toThrow();
  });
  it("automatically preserves references added by a later schema", () => {
    raw.exec("create table future_reference (division_id text references divisions(id)); insert into future_reference values ('division')");
    remove("division","archive");expect(raw.prepare("select * from future_reference").all()).toHaveLength(1);expect(raw.pragma("foreign_key_check")).toEqual([]);
  });
  it("rejects changed usage between preview and confirmation", () => {
    expect(previewDataRemoval(db,admin,"checklist_item","checklist_item").mode).toBe("delete");
    raw.exec("insert into checklist_template_items (template_id,checklist_item_id) values ('template','checklist_item')");expect(()=>remove("checklist_item")).toThrow(/berubah/);expect(row("checklist_item")).toMatchObject({is_active:1});
  });
  it("requires exact current name and a reason", () => {
    const input={entity:"division" as const,id:"division",confirmation:"wrong",reason:"Cleanup",expectedMode:"delete" as const};
    expect(()=>removeData(db,admin,input)).toThrow(/konfirmasi/);expect(()=>removeData(db,admin,{...input,confirmation:names.division,reason:" "})).toThrow();expect(row("division")).toBeDefined();
  });
  it("rejects forged entity IDs and repeat deletion", () => {
    expect(()=>previewDataRemoval(db,admin,"users; delete from users" as RemovalEntity,"user")).toThrow();
    expect(()=>previewDataRemoval(db,admin,"division","missing")).toThrow(/ditemukan/);remove("division");expect(()=>remove("division")).toThrow(/ditemukan/);
  });
  it.each(["delete","archive"] as const)("rolls back %s and child cleanup if audit insertion fails", mode => {
    if(mode==="archive")project({user:"user"});
    raw.exec("insert into user_divisions (user_id,division_id) values ('user','base'); insert into sessions (id,user_id,expires_at,created_at) values ('session','user',9999999999999,1); create trigger audit_failure before insert on audit_logs begin select raise(abort,'audit failure'); end;");
    expect(()=>remove("user",mode)).toThrow();expect(row("user")).toMatchObject({is_active:1});expect(raw.prepare("select * from sessions").all()).toHaveLength(1);expect(raw.prepare("select * from user_divisions").all()).toHaveLength(1);expect(raw.pragma("foreign_key_check")).toEqual([]);
  });
});
