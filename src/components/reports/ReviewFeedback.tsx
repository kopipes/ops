import type {PointReview} from "@/server/services/checklist-reviews";
import {REVIEW_ACTION_LABELS} from "@/server/services/checklist-reviews";
import {formatReportTimestamp} from "@/lib/datetime";
export function ReviewFeedback({reviews,contentHash,timezone,editHref}:{reviews:PointReview[];contentHash:string;timezone:string;editHref?:string}) {
  return <>
            {reviews.length ? <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
              <p className="text-xs font-semibold">Hasil review: {reviews[0].verdict==="ok"?"OK":"Tidak OK — perlu perbaikan"}</p>
              {reviews[0].contentHash!==contentHash?<p className="mt-1 text-xs font-medium text-amber-700">Sudah diperbarui — perlu review ulang</p>:null}
              {reviews[0].action?<p className="mt-1 text-xs font-medium">{REVIEW_ACTION_LABELS[reviews[0].action]}</p>:null}
              {reviews[0].note?<p className="mt-1 whitespace-pre-wrap text-sm">{reviews[0].note}</p>:null}
              <p className="mt-2 text-[11px] text-[var(--muted)]">{reviews[0].authorName} · {formatReportTimestamp(reviews[0].createdAt,timezone)}</p>
              {editHref&&reviews[0].verdict==="not_ok"?<a href={editHref} className="mt-2 inline-flex min-h-tap items-center text-xs font-medium text-[var(--accent)]">Buka laporan untuk perbaikan →</a>:null}
              {reviews.length>1?<details className="mt-2 text-xs"><summary className="cursor-pointer py-2">Riwayat review ({reviews.length})</summary>{reviews.slice(1).map(review=><div key={review.id} className="border-t border-[var(--border)] py-2"><p>{review.authorName} · {formatReportTimestamp(review.createdAt,timezone)} · {review.verdict==="ok"?"OK":"Tidak OK"}{review.action?` · ${REVIEW_ACTION_LABELS[review.action]}`:""}</p><p className="mt-1 whitespace-pre-wrap">{review.note}</p></div>)}</details>:null}
            </div>:null}
  </>;
}
