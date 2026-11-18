"use client";

import {PhotoGallery} from "@/components/reports/PhotoGallery";
import {compressPhoto} from "@/lib/image-compression";
import { useEffect, useState } from "react";
import type {GeneralPhotoGroup} from "@/server/services/report-edits";
import type { EditReportState } from "@/app/edit-actions";

const actionLabels={re_check:"Re-check",re_take_photo:"Re-take photo",others:"Others"};
export interface EditableResult {
  review?:{verdict:"ok"|"not_ok";action:keyof typeof actionLabels|null;note:string|null}|null;
  checkResultId:string;
  photoIds:string[];
  projectChecklistItemId: string;
  label: string;
  categoryName: string;
  result: "ok" | "not_ok" | "na";
  note: string | null;
  isRequired: boolean;
  requiresPhoto: boolean;
}

export function EditReportForm({
  action,
  generalPhotos,
  projectId,
  projectDayId,
  updatedAt,
  reportId,
  notes,
  phaseNote,
  handoverNote,
  observedTime,
  phase,
  timezone,
  results,
}: {
  action: (prev: EditReportState, formData: FormData) => Promise<EditReportState>;
  generalPhotos:GeneralPhotoGroup[];
  projectId:string;
  projectDayId:string;
  updatedAt:number;
  reportId: string;
  notes: string | null;
  phaseNote: string | null;
  handoverNote: string | null;
  observedTime: string;
  phase: string;
  timezone: string;
  results: EditableResult[];
}) {
  const [hydrated,setHydrated]=useState(false);
  useEffect(()=>setHydrated(true),[]);
  const [state, setState] = useState<EditReportState>({});
  const [pending, setPending] = useState(false);
  const [uploads,setUploads]=useState<Record<string,string[]>>({});
  const [uploading,setUploading]=useState(0);
  const upload=async(itemId:string,files:FileList|null,source:"camera"|"gallery")=>{
    if(!files)return;setUploading(n=>n+1);setState({});
    try {for(const file of Array.from(files)) {
      const compressed=await compressPhoto(file);const data=new FormData();data.set("file",compressed.blob,file.name||"photo.jpg");
      data.set("projectId",projectId);data.set("projectDayId",projectDayId);data.set("source",source);data.set("clientUploadId",crypto.randomUUID());
      const response=await fetch("/api/photos",{method:"POST",body:data});const result=await response.json();
      if(!response.ok)throw new Error(result.error??"Upload gagal");
      setUploads(prev=>({...prev,[itemId]:[...(prev[itemId]??[]),result.photoId]}));
    }}catch(err){setState({error:err instanceof Error?err.message:"Upload gagal. Coba lagi."});}finally{setUploading(n=>n-1);}
  };
  const [answers, setAnswers] = useState<Record<string, { result: string; note: string }>>(() => {
    const init: Record<string, { result: string; note: string }> = {};
    for (const r of results) {
      init[r.projectChecklistItemId] = { result: r.result, note: r.note ?? "" };
    }
    return init;
  });

  const set = (id: string, patch: Partial<{ result: string; note: string }>) => {
    setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  /*
   * Call the action directly rather than through `useActionState`.
   * With `useActionState`, a client-side navigation into this page leaves the
   * action running without a request scope, so `cookies()` (via `requireUser`)
   * throws "cookies was called outside a request scope" and the save 500s.
   * Navigating on the client with `window.location` also mirrors the crew form.
   */
  const onSubmit = async (formData: FormData) => {
    if(uploading>0){setState({error:"Tunggu foto selesai diunggah."});return;}
    setPending(true);
    setState({});
    let res: EditReportState;
    try {
      res = await action({}, formData);
    } catch {
      setPending(false);
      setState({ error: "Terjadi kesalahan. Coba lagi." });
      return;
    }
    setPending(false);
    if (res.error) {
      setState({ error: res.error });
      return;
    }
    window.location.href = `/reports/edit/${reportId}?saved=1`;
  };

  return (
    <form action={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="reportId" value={reportId} /><input type="hidden" name="expectedUpdatedAt" value={updatedAt}/>
      {results.map((r) => (
        <div key={r.projectChecklistItemId}>
          <input type="hidden" name={`r_${r.projectChecklistItemId}`} value={answers[r.projectChecklistItemId]?.result ?? ""} />
          <input type="hidden" name={`note_${r.projectChecklistItemId}`} value={answers[r.projectChecklistItemId]?.note ?? ""} />
        </div>
      ))}

      <label className="flex flex-col gap-1 text-sm">Jam kejadian ({timezone})<input type="time" name="observedTime" defaultValue={observedTime} required className="min-h-tap rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-base"/></label>
      {phase !== "monitoring" ? <label className="flex flex-col gap-1 text-sm">Isi laporan {phase}<textarea aria-label={`Isi laporan ${phase}`} name="phaseNote" defaultValue={phaseNote??""} rows={4} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-base"/></label> : null}
      {phase === "closing" ? <label className="flex flex-col gap-1 text-sm">Handover laporan ini<textarea aria-label="Handover laporan ini" name="handoverNote" defaultValue={handoverNote??""} rows={3} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-base"/></label>:null}
      <ul className="flex flex-col gap-2">
        {results.map((r) => {
          const a = answers[r.projectChecklistItemId];
          return (
            <li
              key={r.projectChecklistItemId}
              id={`edit-point-${r.checkResultId}`}
              className="rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <p className="text-sm font-medium">{r.label}</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {r.categoryName}
              </p>

              {r.review?.verdict==="not_ok"?<div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p className="text-xs font-semibold">Permintaan reviewer{r.review.action?` · ${actionLabels[r.review.action]}`:""}</p><p className="mt-1 whitespace-pre-wrap">{r.review.note}</p></div>:null}
              <div className="mt-2 grid grid-cols-3 gap-1">
                {(
                  [
                    ["ok", "OK"],
                    ["not_ok", "Tidak OK"],
                    ["na", "N/A"],
                  ] as const
                ).map(([value, label]) => {
                  const selected = a?.result === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => set(r.projectChecklistItemId, { result: value })}
                      className="min-h-tap rounded-lg border text-sm font-medium"
                      style={{
                        borderColor: selected ? "var(--accent)" : "var(--border)",
                        background: selected
                          ? value === "ok"
                            ? "#dcfce7"
                            : value === "not_ok"
                              ? "#fee2e2"
                              : "var(--border)"
                          : "transparent",
                        color: "var(--fg)",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <textarea
                  aria-label={`Catatan ${r.label}`}
                  value={a.note}
                  onChange={(e) => set(r.projectChecklistItemId, { note: e.target.value })}
                  rows={2}
                  placeholder={a?.result==="not_ok"?"Catatan (wajib)":"Catatan perbaikan (opsional)"}
                  className="mt-2 w-full rounded-lg border px-2 py-1 text-sm"
                  style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
                />
              <PhotoGallery small photos={[...(uploads[r.projectChecklistItemId]??[]),...r.photoIds].map((id,index)=>({id,label:`${r.label} — foto ${index+1}`}))}/>
              {(uploads[r.projectChecklistItemId]??[]).map(id=><input key={id} type="hidden" name={`photo_${r.projectChecklistItemId}`} value={id}/>)}
              <p className="mt-2 text-xs text-[var(--muted)]">Tambah foto perbaikan. Foto sebelumnya tetap tersimpan.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="btn-secondary cursor-pointer text-xs">Ambil foto baru<input aria-label={`Ambil foto perbaikan ${r.label}`} type="file" accept="image/*" capture="environment" disabled={!hydrated||pending||uploading>0} className="sr-only" onChange={e=>{void upload(r.projectChecklistItemId,e.target.files,"camera");e.target.value="";}}/></label>
                <label className="btn-secondary cursor-pointer text-xs">Pilih foto<input aria-label={`Pilih foto perbaikan ${r.label}`} type="file" accept="image/*" multiple disabled={!hydrated||pending||uploading>0} className="sr-only" onChange={e=>{void upload(r.projectChecklistItemId,e.target.files,"gallery");e.target.value="";}}/></label>
              </div>
            </li>
          );
        })}
      </ul>

      {generalPhotos.length?<section><h2 className="mb-2 text-sm font-semibold">Foto laporan</h2><div className="flex flex-col gap-3">{generalPhotos.map((photo,index)=>{
        const key=`general:${photo.id}`;const added=uploads[key]??[];
        return <div id={`edit-photo-${photo.id}`} key={photo.id} className="scroll-mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 target:ring-2 target:ring-[var(--accent)]">
          <p className="text-sm font-medium">Foto {index+1}</p>
          {photo.review?.verdict==="not_ok"?<div className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p className="text-xs font-semibold">Permintaan reviewer{photo.review.action?` · ${actionLabels[photo.review.action]}`:""}</p><p className="mt-1 whitespace-pre-wrap">{photo.review.note}</p></div>:null}
          <PhotoGallery photos={[...added,...photo.photoIds].map((id,i)=>({id,label:`Foto ${index+1} — ${i+1}`}))}/>
          {added.map(id=><input type="hidden" key={id} name={`replacement_${photo.id}`} value={id}/>)}
          <p className="mt-2 text-xs text-[var(--muted)]">Tambah foto pengganti. Foto asli tetap tersimpan.</p>
          <div className="mt-2 flex flex-wrap gap-2"><label className="btn-secondary cursor-pointer text-xs">Ambil foto baru<input type="file" aria-label={`Ambil foto perbaikan Foto ${index+1}`} accept="image/*" capture="environment" className="sr-only" disabled={!hydrated||pending||uploading>0} onChange={e=>{void upload(key,e.target.files,"camera");e.target.value="";}}/></label><label className="btn-secondary cursor-pointer text-xs">Pilih foto<input type="file" aria-label={`Pilih foto perbaikan Foto ${index+1}`} accept="image/*" multiple className="sr-only" disabled={!hydrated||pending||uploading>0} onChange={e=>{void upload(key,e.target.files,"gallery");e.target.value="";}}/></label></div>
        </div>;
      })}</div></section>:null}

      <label className="flex flex-col gap-1">
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Catatan umum
        </span>
        <textarea
          name="notes"
          aria-label="Catatan umum"
          defaultValue={notes ?? ""}
          rows={2}
          className="w-full rounded-lg border px-3 py-2 text-base"
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!hydrated||pending||uploading>0}
        className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent-solid)" }}
      >
        {uploading>0?"Mengunggah foto…":pending ? "Menyimpan…" : "Simpan perubahan"}
      </button>
    </form>
  );
}
