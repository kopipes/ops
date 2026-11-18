"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pointReviewAction } from "@/app/review-actions";
export function PointReviewForm({checkResultId,contentHash}:{checkResultId:string;contentHash:string}) {
  const router=useRouter();
  const [verdict,setVerdict]=useState("not_ok"),[pending,setPending]=useState(false),[message,setMessage]=useState("");
  const [id,setId]=useState("");
  return <details className="mt-3 border-t border-[var(--border)] pt-2"><summary className="min-h-tap cursor-pointer py-2 text-xs font-semibold text-[var(--accent)]">Review poin ini</summary>
    <form className="mt-2 flex flex-col gap-3" action={async data=>{
      setPending(true);setMessage("");const key=id||crypto.randomUUID();setId(key);data.set("id",key);
      try { const result=await pointReviewAction({},data);setMessage(result.error??"Review tersimpan.");if(result.ok){setId("");router.refresh();} }
      catch {setMessage("Review belum tersimpan. Coba lagi.");}finally{setPending(false);}
    }}>
      <input type="hidden" name="checkResultId" value={checkResultId}/><input type="hidden" name="contentHash" value={contentHash}/>
      <label className="text-xs">Hasil review<select aria-label="Hasil review" name="verdict" value={verdict} onChange={e=>{setVerdict(e.target.value);setId("");}} disabled={pending} className="mt-1 min-h-tap w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="not_ok">Tidak OK — perlu perbaikan</option><option value="ok">OK — sudah sesuai</option></select></label>
      {verdict==="not_ok"?<label className="text-xs">Tindak lanjut<select aria-label="Tindak lanjut" name="action" required disabled={pending} className="mt-1 min-h-tap w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-sm"><option value="re_check">Re-check</option><option value="re_take_photo">Re-take photo</option><option value="others">Others</option></select></label>:null}
      <label className="text-xs">{verdict==="not_ok"?"Apa yang perlu diperbaiki?":"Komentar (opsional)"}<textarea name="note" required={verdict==="not_ok"} maxLength={2000} rows={2} disabled={pending} className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-sm"/></label>
      {message?<p role="status" className="text-xs">{message}</p>:null}
      <button disabled={pending} className="btn-primary self-start text-xs">{pending?"Menyimpan…":"Simpan review poin"}</button>
    </form>
  </details>;
}
