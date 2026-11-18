import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "@/server/db/schema";
import { checklistItemInputSchema, type ChecklistItemInput } from "@/lib/schemas";
import type { ActingUser } from "@/server/permissions";
import { canManageChecklistItem } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";

type DB = BetterSQLite3Database<typeof schema>;
type Reader = Pick<DB, "get" | "all" | "run">;
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 1000;
const HEADERS = ["Fase", "Kategori", "Item", "Petunjuk", "Divisi", "Wajib", "Foto wajib", "Urutan"];
export interface ExcelChecklistRow { row: number; values: string[]; sample?: boolean; }
export interface ImportRowPreview { row: number; label: string; phase: string; category: string; division: string; status: "new" | "skip" | "sample" | "error"; error?: string; }
interface ResolvedRow { preview: ImportRowPreview; input?: ChecklistItemInput; key?: string; existingId?: string; }
export interface ChecklistImportPreview { rows: ImportRowPreview[]; added: number; skipped: number; errors: number; samples: number; hash: string; }
const normalize = (value: string) => value.trim().toLocaleLowerCase("id-ID");

/** Validate actual inflated bytes, not just ZIP metadata, before parsing OOXML. */
async function validateArchive(buffer: Buffer) {
  const yauzl = await import("yauzl");
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) return reject(new ValidationError("File .xlsx tidak valid atau terenkripsi"));
      let bytes = 0, entries = 0, stopped = false;
      const fail = (err: unknown) => { if (!stopped) { stopped = true; zip.close(); reject(err instanceof ValidationError ? err : new ValidationError("Arsip Excel tidak valid")); } };
      zip.on("error", fail);
      zip.on("end", () => { if (!stopped) { stopped = true; zip.close(); resolve(); } });
      zip.on("entry", entry => {
        if (++entries > 256 || entry.uncompressedSize > 16 * 1024 * 1024 || /vbaProject|externalLinks/i.test(entry.fileName)) return fail(new ValidationError("Isi Excel terlalu besar atau mengandung makro/tautan eksternal"));
        if (entry.fileName.endsWith("/")) return zip.readEntry();
        zip.openReadStream(entry, (err, stream) => {
          if (err || !stream) return fail(err);
          let tail = "";
          stream.on("error", fail);
          stream.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            const text = tail + chunk.toString("utf8");
            if (bytes > 16 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(text) || (entry.fileName.endsWith(".xml") && /<(?:[\w.-]+:)?(?:f|hyperlink)(?:\s|>)/i.test(text))) { stream.destroy(); fail(new ValidationError("Isi Excel terlalu besar atau mengandung rumus/tautan yang tidak didukung")); }
            tail = text.slice(-24);
          });
          stream.on("end", () => { if (!stopped) zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

export async function parseChecklistWorkbook(buffer: Buffer): Promise<ExcelChecklistRow[]> {
  if (!buffer.length || buffer.length > IMPORT_MAX_BYTES) throw new ValidationError("File .xlsx maksimal 2 MB");
  await validateArchive(buffer);
  const {readSheet}=await import("read-excel-file/node");
  let data: unknown[][];
  try { data=await readSheet(buffer,"Checklist"); }
  catch { throw new ValidationError("File Excel tidak bisa dibaca. Gunakan sheet Checklist pada template .xlsx dari Pulse."); }
  const text=(value:unknown)=>value==null?"":String(value).trim();
  if(HEADERS.some((header,i)=>normalize(text(data[0]?.[i]))!==normalize(header)))throw new ValidationError("Judul kolom tidak sesuai. Gunakan kolom pada template Pulse.");
  const hasMarker=normalize(text(data[0]?.[8]))==="jenis baris";
  if(data.length>2002||data.some(row=>row.length>(hasMarker?9:8)))throw new ValidationError("Maksimal 1.000 item dan kolom sesuai template");
  const rows:ExcelChecklistRow[]=[];
  for(let i=1;i<data.length;i++) {
    const values=HEADERS.map((_,col)=>text(data[i][col]));
    const marker=hasMarker?normalize(text(data[i][8])):"";
    if(marker && !["contoh","data"].includes(marker))throw new ValidationError(`Baris ${i+1}: Jenis baris harus CONTOH, DATA, atau kosong`);
    if(values.some(Boolean))rows.push({row:i+1,values,...(marker==="contoh"?{sample:true}:{})});
  }
  if(!rows.some(row=>!row.sample))throw new ValidationError("Checklist belum berisi data. Baris CONTOH dilewati; isi data Anda atau hapus baris contoh.");
  if(rows.filter(row=>!row.sample).length>IMPORT_MAX_ROWS)throw new ValidationError("Maksimal 1.000 item per impor");
  return rows;
}

function currentImporter(db: Reader, actor: ActingUser): ActingUser {
  if (!actor.isActive || !["admin", "manager"].includes(actor.role)) throw new ForbiddenError();
  const row = db.get<{ role: ActingUser["role"]; is_active: number; pending_approval: number; must_change_password: number }>(sql`select role,is_active,pending_approval,must_change_password from users where id=${actor.id}`);
  if (!row || !row.is_active || row.pending_approval || row.must_change_password || !["admin", "manager"].includes(row.role)) throw new ForbiddenError();
  const memberships = db.all<{ division_id: string }>(sql`select division_id from user_divisions where user_id=${actor.id}`);
  return { id: actor.id, role: row.role, isActive: true, divisionIds: memberships.map(r => r.division_id) };
}

function buildPlan(db: Reader, actor: ActingUser, rows: ExcelChecklistRow[], defaultDivisionId: string, templateName: string) {
  const user = currentImporter(db, actor);
  if (rows.filter(row=>!row.sample).length > IMPORT_MAX_ROWS) throw new ValidationError("Maksimal 1.000 item per impor");
  if (templateName && (templateName.length < 3 || templateName.length > 100)) throw new ValidationError("Nama template 3–100 karakter");
  const categories = db.all<{id:string;name:string}>(sql`select id,name from checklist_categories where is_active=1`);
  const divisions = db.all<{id:string;name:string;code:string}>(sql`select id,name,code from divisions where is_active=1`);
  if(defaultDivisionId && !divisions.some(d=>d.id===defaultDivisionId)) throw new ValidationError("Divisi tujuan harus aktif");
  const existing = db.all<{id:string;label:string;phase:string;division_id:string|null}>(sql`select id,label,phase,division_id from checklist_items`);
  const key = (phase:string, label:string, divisionId:string|null) => JSON.stringify([phase, normalize(label), divisionId]);
  const seen = new Map(existing.map(r => [key(r.phase,r.label,r.division_id),r.id]));
  const resolved: ResolvedRow[] = rows.map(row => {
    const [phaseRaw,categoryRaw,label,description,divisionRaw,requiredRaw,photoRaw,orderRaw] = row.values;
    const preview: ImportRowPreview = { row:row.row,label,phase:phaseRaw,category:categoryRaw,division:divisionRaw || "Sesuai pilihan",status:"new" };
    if(row.sample)return {preview:{...preview,status:"sample"}};
    try {
      const phase = normalize(phaseRaw);
      const category = categories.find(c => normalize(c.name) === normalize(categoryRaw));
      if (!category) throw new ValidationError(`Kategori aktif “${categoryRaw}” tidak ditemukan`);
      const token = normalize(divisionRaw);
      const division = token ? token === "global" ? null : divisions.find(d => normalize(d.name) === token || normalize(d.code) === token) : defaultDivisionId ? divisions.find(d => d.id === defaultDivisionId) : null;
      if (division === undefined) throw new ValidationError("Divisi aktif tidak ditemukan");
      const divisionId = division?.id ?? null;
      if (!canManageChecklistItem(user, divisionId)) throw new ForbiddenError("Manager hanya dapat mengimpor item ke divisinya sendiri");
      const flag = (value:string, fallback:boolean) => {
        if (!value) return fallback;
        if (["ya","yes","true","1"].includes(normalize(value))) return true;
        if (["tidak","no","false","0"].includes(normalize(value))) return false;
        throw new ValidationError("Wajib / Foto wajib harus Ya atau Tidak");
      };
      const parsed = checklistItemInputSchema.safeParse({label,description,phase,categoryId:category.id,divisionId:divisionId??"",isRequired:flag(requiredRaw,true),requiresPhoto:flag(photoRaw,false),sortOrder:orderRaw ? Number(orderRaw) : row.row-2,isActive:true});
      if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Data tidak valid");
      const identity=key(phase,label,divisionId);const existingId=seen.get(identity);
      preview.division=division?.name ?? "Global";preview.phase=phase;preview.status=existingId !== undefined ? "skip" : "new";
      seen.set(identity,existingId ?? "");
      return {preview,input:parsed.data,key:identity,existingId:existingId || undefined};
    } catch(err) {preview.status="error";preview.error=err instanceof Error?err.message:"Data tidak valid";return {preview};}
  });
  const newRows=resolved.filter(r=>r.preview.status==="new");
  if (templateName && !canManageChecklistItem(user,defaultDivisionId || null)) throw new ForbiddenError("Divisi tujuan template harus di divisi yang dapat dikelola");
  const summary: ChecklistImportPreview={rows:resolved.map(r=>r.preview),added:newRows.length,skipped:resolved.filter(r=>r.preview.status==="skip").length,errors:resolved.filter(r=>r.preview.status==="error").length,samples:resolved.filter(r=>r.preview.status==="sample").length,hash:createHash("sha256").update(JSON.stringify({resolved,defaultDivisionId,templateName,actor:user.id})).digest("hex")};
  return {resolved,summary,user};
}

export function previewChecklistImport(db: DB, actor: ActingUser, rows: ExcelChecklistRow[], defaultDivisionId: string, templateName: string) {
  return db.transaction(tx => buildPlan(tx,actor,rows,defaultDivisionId,templateName).summary);
}

export function commitChecklistImport(db: DB, actor: ActingUser, rows: ExcelChecklistRow[], defaultDivisionId: string, templateName: string, expectedHash: string) {
  return db.transaction(tx => {
    currentImporter(tx,actor);
    if(!/^[a-f0-9]{64}$/.test(expectedHash))throw new ValidationError("Periksa file sebelum menyimpan");
    const prior=tx.get<{meta_json:string}>(sql`select meta_json from audit_logs where action='checklist.imported' and entity_id=${expectedHash} and user_id=${actor.id} limit 1`);
    if(prior) { const saved=JSON.parse(prior.meta_json);return {added:saved.added as number,skipped:saved.skipped as number,templateId:saved.templateId as string|null}; }
    const {resolved,summary,user}=buildPlan(tx,actor,rows,defaultDivisionId,templateName);
    if (summary.errors) throw new ValidationError("Perbaiki semua baris yang bermasalah sebelum impor");
    if (summary.hash !== expectedHash) throw new ValidationError("Data berubah sejak pratinjau. Periksa file kembali.");
    const now=Date.now(),ids=new Map<string,string>();
    for(const row of resolved) {
      if(row.preview.status==="sample")continue;
      if(row.preview.status==="skip") {if(row.existingId)ids.set(row.key!,row.existingId);continue;}
      const item=row.input!,id=randomUUID();ids.set(row.key!,id);
      tx.run(sql`insert into checklist_items (id,label,description,phase,category_id,division_id,is_required,requires_photo,sort_order,is_active,created_by,created_at,updated_at) values (${id},${item.label},${item.description??null},${item.phase},${item.categoryId},${item.divisionId},${item.isRequired?1:0},${item.requiresPhoto?1:0},${item.sortOrder},1,${user.id},${now},${now})`);
    }
    let templateId: string | null = null;
    if(templateName) {
      // Inactive duplicate items are retained but never silently reactivated.
      const usable=[...new Set(ids.values())].filter(id=>tx.get<{is_active:number}>(sql`select is_active from checklist_items where id=${id}`)?.is_active);
      if(!usable.length)throw new ValidationError("Tidak ada item aktif untuk disimpan sebagai template");
      templateId=randomUUID();tx.run(sql`insert into checklist_templates (id,name,division_id,is_active,created_by,created_at,updated_at) values (${templateId},${templateName},${defaultDivisionId||null},1,${user.id},${now},${now})`);
      usable.forEach((id,index)=>tx.run(sql`insert into checklist_template_items (template_id,checklist_item_id,sort_order) values (${templateId},${id},${index})`));
    }
    const importId=randomUUID();
    tx.run(sql`insert into audit_logs (id,user_id,action,entity_type,entity_id,meta_json,created_at) values (${importId},${user.id},'checklist.imported','checklist_import',${expectedHash},${JSON.stringify({added:summary.added,skipped:summary.skipped,templateId,templateName:templateName||null,itemIds:[...ids.values()]})},${now})`);
    return {added:summary.added,skipped:summary.skipped,templateId};
  });
}
