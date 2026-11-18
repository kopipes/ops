import {listAllReviewNotifications} from "@/server/services/all-review-notifications";
import {PhotoGallery} from "@/components/reports/PhotoGallery";
import {AppShell} from "@/components/AppShell";
import {requireUser} from "@/server/auth/current-user";
import {getDb} from "@/server/db";
import {REVIEW_ACTION_LABELS} from "@/server/services/checklist-reviews";
import {formatReportTimestamp} from "@/lib/datetime";
import {OpenNotificationButton} from "@/components/review/OpenNotificationButton";
export const metadata={title:"Notifikasi — Pulse"};
export default async function NotificationsPage({searchParams}:{searchParams:Promise<{unavailable?:string}>}) {
  const session=await requireUser();const rows=listAllReviewNotifications(getDb(),session.user);const params=await searchParams;
  return <AppShell contentWidth="form"><h1 className="text-2xl font-semibold">Notifikasi</h1><p className="mt-2 text-sm text-[var(--muted)]">Review untuk laporan Anda. Buka untuk melihat poin atau foto yang dimaksud.</p>
    {params.unavailable?<p role="status" className="mt-4 rounded-xl border border-[var(--border)] p-4 text-sm">Notifikasi tidak tersedia atau akses project sudah berubah.</p>:null}
    {rows.length?<ul className="mt-5 flex flex-col gap-3">{rows.map(row=><li key={row.id} className={`rounded-xl border border-[var(--border)] p-4 ${row.readAt===null?"bg-[var(--accent-soft)]":"bg-[var(--surface)]"}`}>
      <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold">{row.projectName} · {row.phase}</p>{row.readAt===null?<span className="status-badge tone-accent">Baru</span>:null}</div>
      <p className="mt-2 text-sm font-semibold">{row.label}</p><p className="mt-1 text-xs">{row.verdict==="ok"?"Review OK":`Perlu perbaikan${row.action?` · ${REVIEW_ACTION_LABELS[row.action]}`:""}`}</p>
      {row.note?<p className="mt-2 whitespace-pre-wrap text-sm">{row.note}</p>:null}
      <p className="mt-2 text-xs text-[var(--muted)]">{row.authorName} · {formatReportTimestamp(row.createdAt,row.timezone)}</p>
      {row.photoId?<PhotoGallery small photos={[{id:row.photoId,label:"Foto yang direview"}]}/>:null}
      <OpenNotificationButton id={row.id} kind={row.kind}/>
    </li>)}</ul>:<p className="mt-5 rounded-xl border border-[var(--border)] p-5 text-sm text-[var(--muted)]">Belum ada notifikasi review.</p>}
  </AppShell>;
}
