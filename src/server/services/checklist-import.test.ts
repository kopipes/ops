import Database from "better-sqlite3";
import ExcelJS from "exceljs";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { beforeEach, afterEach, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import { parseChecklistWorkbook, previewChecklistImport, commitChecklistImport, type ExcelChecklistRow } from "./checklist-import";
let raw:Database.Database,db:ReturnType<typeof drizzle<typeof schema>>;
const admin:ActingUser={id:"admin",role:"admin",isActive:true,divisionIds:["d1"]};
const manager:ActingUser={id:"manager",role:"manager",isActive:true,divisionIds:["d1"]};
const rows:ExcelChecklistRow[]=[{row:2,values:["Opening","Venue","Area siap","Periksa akses","","Ya","Tidak","1"]},{row:3,values:["Monitoring","Venue","Pantau area","Catat kondisi","","Ya","Ya","2"]},{row:4,values:["Closing","Venue","Tutup area","","","Tidak","Tidak","3"]}];
beforeEach(()=>{
 raw=new Database(":memory:");raw.pragma('foreign_keys=ON');db=drizzle(raw,{schema});migrate(db,{migrationsFolder:resolve('src/server/db/migrations')});
 raw.exec("insert into divisions (id,code,name,created_at,updated_at) values ('d1','D1','Division One',1,1),('d2','D2','Division Two',1,1); insert into users (id,name,email,password_hash,role,created_at,updated_at) values ('admin','Admin','a@x','h','admin',1,1),('manager','Manager','m@x','h','manager',1,1); insert into user_divisions (user_id,division_id) values ('manager','d1'),('admin','d1'); insert into checklist_categories (id,name,created_at,updated_at) values ('cat','Venue',1,1)");
});
afterEach(()=>raw.close());
async function workbook(values:unknown[][],header=["Fase","Kategori","Item","Petunjuk","Divisi","Wajib","Foto wajib","Urutan"]){const wb=new ExcelJS.Workbook();const sheet=wb.addWorksheet('Checklist');sheet.addRow(header);values.forEach(row=>sheet.addRow(row));return Buffer.from(await wb.xlsx.writeBuffer());}
it('reads the shipped template and requires actual input rows',async()=>{
 const file=await readFile(resolve('public/templates/pulse-checklist.xlsx'));await expect(parseChecklistWorkbook(file)).rejects.toThrow(/CONTOH/);
});
it('ignores marked sample rows, with or without the example present',async()=>{
 const headers=["Fase","Kategori","Item","Petunjuk","Divisi","Wajib","Foto wajib","Urutan","Jenis baris"];
 const file=await workbook([[...rows[0].values,'CONTOH'],[...rows[1].values,'DATA']],headers);
 const parsed=await parseChecklistWorkbook(file);expect(parsed[0].sample).toBe(true);
 const preview=previewChecklistImport(db,admin,parsed,'','');expect(preview).toMatchObject({added:1,samples:1,errors:0});commitChecklistImport(db,admin,parsed,'','',preview.hash);expect(raw.prepare('select label from checklist_items').all()).toEqual([{label:'Pantau area'}]);
 expect(await parseChecklistWorkbook(await workbook([rows[0].values]))).toEqual([rows[0]]);
});

it('parses row numbers, skips blank lines, and preserves numeric/boolean text',async()=>{
 const file=await workbook([rows[0].values,[],rows[1].values]);const result=await parseChecklistWorkbook(file);expect(result.map(r=>r.row)).toEqual([2,4]);expect(result[0].values[7]).toBe('1');
});
it.each(['bad zip','not excel'])('rejects malformed %s',async value=>{await expect(parseChecklistWorkbook(Buffer.from(value))).rejects.toThrow();});
it('rejects oversize uploads',async()=>{await expect(parseChecklistWorkbook(Buffer.alloc(2*1024*1024+1))).rejects.toThrow(/2 MB/);});
it('rejects formulas and invalid headers',async()=>{
 await expect(parseChecklistWorkbook(await workbook([[{formula:'1+1'},'Venue','Item']]))).rejects.toThrow(/rumus/);
 await expect(parseChecklistWorkbook(await workbook([rows[0].values],['wrong']))).rejects.toThrow(/kolom/);
});
it('rejects too many rows',async()=>{await expect(parseChecklistWorkbook(await workbook(Array.from({length:1001},()=>rows[0].values)))).rejects.toThrow(/1.000/);});
it('imports all phases atomically and creates a reusable template',()=>{
 const preview=previewChecklistImport(db,admin,rows,'','Imported checklist');expect(preview).toMatchObject({added:3,skipped:0,errors:0});
 const result=commitChecklistImport(db,admin,rows,'','Imported checklist',preview.hash);expect(result.added).toBe(3);expect(result.templateId).toBeTruthy();expect(raw.prepare('select count(*) as n from checklist_template_items').get()).toEqual({n:3});expect(raw.pragma('foreign_key_check')).toEqual([]);
});
it('retries do not create duplicate items or templates',()=>{
 const preview=previewChecklistImport(db,admin,rows,'','Reusable template');const first=commitChecklistImport(db,admin,rows,'','Reusable template',preview.hash);expect(commitChecklistImport(db,admin,rows,'','Reusable template',preview.hash)).toEqual(first);expect(raw.prepare('select count(*) as n from checklist_templates').get()).toEqual({n:1});expect(raw.prepare('select count(*) as n from audit_logs').get()).toEqual({n:1});
});
it('skips duplicate rows and existing/inactive items without overwriting',()=>{
 const input=[rows[0],{...rows[0],row:3}];const preview=previewChecklistImport(db,admin,input,'','');expect(preview).toMatchObject({added:1,skipped:1});commitChecklistImport(db,admin,input,'','',preview.hash);raw.exec('update checklist_items set is_active=0');const again=previewChecklistImport(db,admin,rows.slice(0,1),'','');expect(again).toMatchObject({added:0,skipped:1});expect(raw.prepare('select is_active from checklist_items').get()).toEqual({is_active:0});
});
it('managers import only to owned divisions, not Global or another division',()=>{
 expect(previewChecklistImport(db,manager,rows,'d1','Own template')).toMatchObject({added:3,errors:0});
 expect(previewChecklistImport(db,manager,rows,'','').errors).toBe(3);
 const input=[{row:2,values:[...rows[0].values]}];input[0].values[4]='D2';expect(previewChecklistImport(db,manager,input,'d1','').errors).toBe(1);
});
it('rejects newly revoked roles or memberships at commit time',()=>{
 const preview=previewChecklistImport(db,manager,rows,'d1','');raw.exec("delete from user_divisions where user_id='manager'");expect(()=>commitChecklistImport(db,manager,rows,'d1','',preview.hash)).toThrow();expect(raw.prepare('select count(*) as n from checklist_items').get()).toEqual({n:0});
});
it.each(["role='user'","is_active=0","pending_approval=1","must_change_password=1"])('checks fresh importer privileges: %s',change=>{
 raw.exec(`update users set ${change} where id='admin'`);expect(()=>previewChecklistImport(db,admin,rows,'','')).toThrow();
});
it('reports row errors and rejects the entire batch',()=>{
 const input=structuredClone(rows);input[1].values[1]='Unknown';const preview=previewChecklistImport(db,admin,input,'','');expect(preview.rows[1]).toMatchObject({row:3,status:'error'});expect(()=>commitChecklistImport(db,admin,input,'','',preview.hash)).toThrow(/Perbaiki/);expect(raw.prepare('select count(*) as n from checklist_items').get()).toEqual({n:0});
});
it('requires a new preview after database data changes',()=>{
 const preview=previewChecklistImport(db,admin,rows,'','');raw.exec("update checklist_categories set name='Renamed' where id='cat'");expect(()=>commitChecklistImport(db,admin,rows,'','',preview.hash)).toThrow();
});
it('rolls back every item/template when audit fails',()=>{
 const preview=previewChecklistImport(db,admin,rows,'','Template rollback');raw.exec("create trigger fail_audit before insert on audit_logs begin select raise(abort,'audit failed'); end");expect(()=>commitChecklistImport(db,admin,rows,'','Template rollback',preview.hash)).toThrow();expect(raw.prepare('select count(*) as n from checklist_items').get()).toEqual({n:0});expect(raw.prepare('select count(*) as n from checklist_templates').get()).toEqual({n:0});
});
