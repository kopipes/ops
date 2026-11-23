import type { ReportBlock } from "@/server/services/reports-review";

import {PhotoGallery} from "./PhotoGallery";
import {PointReviewForm} from "@/components/review/PointReviewForm";
import {ReviewFeedback} from "./ReviewFeedback";

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
            <ReviewFeedback reviews={result.reviews} contentHash={result.contentHash} timezone={timezone} editHref={canEdit?`/reports/edit/${reportId}#edit-point-${result.id}`:undefined}/>
            {canReview?<PointReviewForm key={result.contentHash} checkResultId={result.id} contentHash={result.contentHash}/>:null}
          </li>;
        })}
      </ul> : <p className="px-3 pb-3 text-xs" style={{ color: "var(--muted)" }}>Tidak ada jawaban checklist pada laporan ini. Checklist project dapat dilihat melalui tautan di atas.</p>}
    </details>
  );
}
