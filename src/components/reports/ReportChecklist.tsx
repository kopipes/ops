import type { ReportBlock } from "@/server/services/reports-review";

import {PhotoGallery} from "./PhotoGallery";
import {PointReviewForm} from "@/components/review/PointReviewForm";
import {REVIEW_ACTION_LABELS} from "@/server/services/checklist-reviews";
import {formatReportTimestamp} from "@/lib/datetime";

const styles = {
  ok: { label: "OK", bg: "#dcfce7", fg: "#166534" },
  not_ok: { label: "Tidak OK", bg: "#fee2e2", fg: "#991b1b" },
  na: { label: "N/A", bg: "#e2e8f0", fg: "#334155" },
};

/** All recorded answers are visible initially, including OK notes and categories. */
export function ReportChecklist({ reportId, phase, results, issueContext, canReview=false, canEdit=false, timezone="Asia/Jakarta" }: { reportId: string; phase: string; results: ReportBlock["results"]; issueContext?: {projectId:string;dayId:string;phase:string};canReview?:boolean;canEdit?:boolean;timezone?:string }) {
  const ordered = [...results].sort((a, b) => ({ not_ok: 0, na: 1, ok: 2 }[a.result] - { not_ok: 0, na: 1, ok: 2 }[b.result]));
  return (
    <details id={`checklist-${reportId}`} open className="mt-3 scroll-mt-5 rounded-lg border" style={{ borderColor: "var(--border)" }}>
      <summary className="min-h-tap cursor-pointer rounded-lg px-3 py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600">
        Checklist {phase} ({results.length} item)
        <span className="ml-2 text-xs font-normal" style={{ color: "var(--muted)" }}>
          {results.filter(r => r.result === "ok").length} OK · {results.filter(r => r.result === "not_ok").length} Tidak OK · {results.filter(r => r.result === "na").length} N/A
        </span>
      </summary>
      {ordered.length ? <ul className="flex flex-col gap-2 px-3 pb-3">
        {ordered.map(result => {
          const tone = styles[result.result];
          return <li id={`point-${result.id}`} key={result.id} className="scroll-mt-6 rounded-lg border px-3 py-2 target:ring-2 target:ring-[var(--accent)]" style={{ borderColor: "var(--border)", background: result.result === "not_ok" ? tone.bg : "var(--bg)" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs" style={{ color: "var(--muted)" }}>{result.categoryName}</p>
                <p className="text-sm font-medium">{result.label}</p>
              </div>
              <span className="shrink-0 rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: tone.bg, color: tone.fg }}>{tone.label}</span>
            </div>
            {result.result === "not_ok" && issueContext ? <a href={`/issues/new?${new URLSearchParams({...issueContext,reportId,checkResultId:result.id,title:result.label,description:result.note??""}).toString()}`} className="mt-2 inline-flex min-h-tap items-center rounded-lg border border-red-700/20 px-3 text-xs text-red-800">Jadikan Issue</a> : null}
            {result.note ? <p className="mt-1 whitespace-pre-wrap text-xs" style={{ color: "var(--muted)" }}>{result.note}</p> : null}
            <PhotoGallery small photos={result.photoIds.map((id,index)=>({id,label:`${result.label} — foto ${index+1}`}))}/>
            {result.reviews.length ? <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="text-xs font-semibold">Hasil review: {result.reviews[0].verdict==="ok"?"OK":"Tidak OK — perlu perbaikan"}</p>
              {result.reviews[0].contentHash!==result.contentHash?<p className="mt-1 text-xs font-medium text-amber-700">Sudah diperbarui — perlu review ulang</p>:null}
              {result.reviews[0].action?<p className="mt-1 text-xs font-medium">{REVIEW_ACTION_LABELS[result.reviews[0].action]}</p>:null}
              {result.reviews[0].note?<p className="mt-1 whitespace-pre-wrap text-sm">{result.reviews[0].note}</p>:null}
              <p className="mt-2 text-[11px] text-[var(--muted)]">{result.reviews[0].authorName} · {formatReportTimestamp(result.reviews[0].createdAt,timezone)}</p>
              {canEdit&&issueContext&&result.reviews[0].verdict==="not_ok"?<a href={`/reports/edit/${reportId}#edit-point-${result.id}`} className="mt-2 inline-flex min-h-tap items-center text-xs font-medium text-[var(--accent)]">Buka laporan untuk perbaikan →</a>:null}
              {result.reviews.length>1?<details className="mt-2 text-xs"><summary className="cursor-pointer py-2">Riwayat review ({result.reviews.length})</summary>{result.reviews.slice(1).map(review=><div key={review.id} className="border-t border-[var(--border)] py-2"><p>{review.authorName} · {formatReportTimestamp(review.createdAt,timezone)} · {review.verdict==="ok"?"OK":"Tidak OK"}{review.action?` · ${REVIEW_ACTION_LABELS[review.action]}`:""}</p><p className="mt-1 whitespace-pre-wrap">{review.note}</p></div>)}</details>:null}
            </div>:null}
            {canReview?<PointReviewForm key={result.contentHash} checkResultId={result.id} contentHash={result.contentHash}/>:null}
          </li>;
        })}
      </ul> : <p className="px-3 pb-3 text-xs" style={{ color: "var(--muted)" }}>Tidak ada jawaban checklist pada laporan ini. Checklist project dapat dilihat melalui tautan di atas.</p>}
    </details>
  );
}
