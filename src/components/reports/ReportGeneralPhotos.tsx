import type {ReportBlock} from '@/server/services/reports-review';
import {PhotoGallery} from './PhotoGallery';
import {ReviewFeedback} from './ReviewFeedback';
import {PointReviewForm} from '@/components/review/PointReviewForm';
export function ReportGeneralPhotos({photos,reportId,canReview,canEdit,timezone}:{photos:ReportBlock['photos'];reportId:string;canReview:boolean;canEdit:boolean;timezone:string}) {
 if(!photos.length)return null;
 return <div className="mt-4"><h3 className="text-xs font-semibold text-[var(--muted)]">Foto laporan</h3><div className="mt-2 grid gap-3 sm:grid-cols-2">{photos.map((photo,index)=><section id={`photo-${photo.id}`} key={photo.id} className="scroll-mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 target:ring-2 target:ring-[var(--accent)]">
  <p className="text-xs font-semibold">Foto {index+1}</p>
  <PhotoGallery photos={[...photo.replacementIds.map((id,i)=>({id,label:`Foto ${index+1} — perbaikan ${i+1}`})),{id:photo.id,label:`Foto ${index+1} — asli`}]}/>
  {photo.replacementIds.length?<p className="mt-2 text-xs text-[var(--muted)]">Foto perbaikan ditampilkan lebih dahulu; foto asli tetap tersimpan.</p>:null}
  <ReviewFeedback reviews={photo.reviews} contentHash={photo.contentHash} timezone={timezone} editHref={canEdit?`/reports/edit/${reportId}#edit-photo-${photo.id}`:undefined}/>
  {canReview?<PointReviewForm key={photo.contentHash} photoId={photo.id} contentHash={photo.contentHash}/>:null}
 </section>)}</div></div>;
}
