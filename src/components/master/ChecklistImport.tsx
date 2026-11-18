"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChecklistImportPreview } from "@/server/services/checklist-import";
export function ChecklistImport({ divisions, isAdmin, managerDivisionId }: {divisions:{id:string;name:string}[];isAdmin:boolean;managerDivisionId?:string|null}) {
  const router=useRouter(),fileInput=useRef<HTMLInputElement>(null);
  const [open,setOpen]=useState(false),[pending,setPending]=useState(false),[preview,setPreview]=useState<ChecklistImportPreview>(),[error,setError]=useState(""),[message,setMessage]=useState("");
  const [divisionId,setDivisionId]=useState(isAdmin?"":managerDivisionId??""),[templateName,setTemplateName]=useState("");
  const changed=()=>{setPreview(undefined);setError("");setMessage("");};
  const send=async(mode:"preview"|"commit")=>{
    const file=fileInput.current?.files?.[0];if(!file){setError("Pilih file Excel terlebih dahulu");return;}
    setPending(true);setError("");setMessage("");
    try {
      const body=new FormData();body.set("file",file);body.set("divisionId",divisionId);body.set("templateName",templateName);body.set("mode",mode);if(preview)body.set("hash",preview.hash);
      const response=await fetch("/api/checklist-import",{method:"POST",body});const result=await response.json();
      if(!response.ok)throw new Error(result.error??"Impor gagal");
      if(mode==="preview")setPreview(result.preview);
      else {setMessage(`${result.result.added} item ditambahkan, ${result.result.skipped} duplikat dilewati.${result.result.templateId?" Template juga tersimpan dan dapat dipilih saat membuat project.":""}`);setPreview(undefined);if(fileInput.current)fileInput.current.value="";router.refresh();}
    }catch(err){setError(err instanceof Error?err.message:"Impor gagal");}finally{setPending(false);}
  };
  const field="min-h-tap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-base";
  return <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">Impor checklist dari Excel</h2><p className="mt-1 text-xs text-[var(--muted)]">Unduh template, isi, lalu periksa sebelum disimpan.</p></div><div className="flex flex-wrap gap-2"><a href="/templates/pulse-checklist.xlsx" download className="btn-secondary text-xs">Unduh template Excel</a><button type="button" onClick={()=>setOpen(!open)} aria-expanded={open} className="btn-secondary text-xs">{open?"Tutup impor":"Upload Excel"}</button></div></div>
    {open?<div className="mt-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">File checklist (.xlsx)<input ref={fileInput} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={changed} disabled={pending} className={field}/></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1 text-sm">Divisi tujuan jika kolom kosong<select value={divisionId} onChange={e=>{setDivisionId(e.target.value);changed();}} disabled={pending} className={field}>{isAdmin?<option value="">Global</option>:null}{divisions.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label><label className="flex flex-col gap-1 text-sm">Nama template (opsional)<input value={templateName} onChange={e=>{setTemplateName(e.target.value);changed();}} maxLength={100} disabled={pending} className={field} placeholder="Contoh: Checklist Event Harian"/></label></div>
      <p className="text-xs text-[var(--muted)]">Maksimal 1.000 item / 2 MB. Gunakan kategori aktif. Baris CONTOH otomatis dilewati. Duplikat dilewati, data lama tetap tersimpan.</p>
      {error?<p role="alert" className="text-sm text-red-700">{error}</p>:null}{message?<p role="status" className="text-sm text-emerald-800">{message}</p>:null}
      <button type="button" onClick={()=>void send("preview")} disabled={pending} className="btn-secondary self-start disabled:opacity-60">{pending?"Memproses…":"Periksa file"}</button>
      {preview?<><p className="text-sm font-medium">{preview.added} baru · {preview.skipped} duplikat · {preview.errors} bermasalah · {preview.samples} contoh dilewati</p><div className="max-h-80 overflow-auto rounded-lg border border-[var(--border)]"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-[var(--surface)]"><tr>{["Baris","Item","Fase / kategori","Divisi","Hasil"].map(t=><th key={t} className="px-3 py-2">{t}</th>)}</tr></thead><tbody>{preview.rows.map(row=><tr key={row.row} className="border-t border-[var(--border)]"><td className="p-3">{row.row}</td><td className="min-w-40 p-3">{row.label}</td><td className="p-3">{row.phase} / {row.category}</td><td className="p-3">{row.division}</td><td className={`p-3 ${row.status==="error"?"text-red-700":""}`}>{row.error??(row.status==="sample"?"Contoh — dilewati":row.status==="skip"?"Dilewati":"Baru")}</td></tr>)}</tbody></table></div><button type="button" disabled={pending||preview.errors>0||(preview.added===0&&!templateName.trim())} onClick={()=>void send("commit")} className="min-h-tap self-start rounded-xl bg-[var(--accent-solid)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending?"Menyimpan…":`Impor ${preview.added} item`}</button></>:null}
    </div>:null}
  </section>;
}
