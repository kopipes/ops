import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getDayDetail, type GalleryPhoto, type ReportBlock } from "@/server/services/reports-review";
import { eq } from "drizzle-orm";
import { projectDays } from "@/server/db/schema";
import { markReviewedAction, unmarkReviewedAction } from "@/app/review-actions";
import { ExportPdfForm } from "@/components/pdf/ExportPdfForm";
import { exportDailyPdfAction } from "@/app/pdf-actions";
import { formatReportTimestamp } from "@/lib/datetime";
import { PhotoGallery } from "@/components/reports/PhotoGallery";
import {ReportGeneralPhotos} from "@/components/reports/ReportGeneralPhotos";
import { ReportChecklist } from "@/components/reports/ReportChecklist";
import { Pill, SEVERITY_TONE, STATUS_TONE } from "@/components/issues/IssueBadges";
import { issueStatusLabel, severityLabel } from "@/lib/schemas";

export const metadata = { title: "Detail Hari — Pulse" };

function fmtTime(at: number | null, tz: string) {
  if (!at) return "—";
  return formatReportTimestamp(at, tz);
}

function PhotoGrid({ photos }: { photos: GalleryPhoto[] }) {
  return <PhotoGallery photos={photos.map((photo, index) => ({
    id: photo.id,
    label: `Foto ${photo.phase ?? "laporan"} ${index + 1}`,
    caption: photo.uploadedByName ? `Diunggah oleh ${photo.uploadedByName}` : undefined,
  }))} />;
}

function ReportSection({
  title,
  block,
  tz,
  projectId,
  dayId,
  canReview = false,
  canCreateIssue = false,
}: {
  title: string;
  block: ReportBlock | null;
  tz: string;
  projectId: string;
  dayId: string;
  canReview?: boolean;
  canCreateIssue?: boolean;
}) {
  if (!block) {
    return (
      <section className="mb-4">
        <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
          {title}
        </h2>
        <p
          className="rounded-lg border px-3 py-3 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "#dc2626" }}
        >
          Belum diisi
        </p>
      </section>
    );
  }


  return (
    <section id={`report-${block.reportId}`} className="mb-4 scroll-mt-4">
      <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
        {title}
      </h2>
      <div
        className="rounded-lg border px-3 py-2"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Waktu kejadian: {fmtTime(block.observedAt, tz)} · Diisi oleh {block.submittedByName ?? "—"} · Waktu pengisian: {fmtTime(block.submittedAt, tz)}
          {block.isLate ? (
            <span style={{ color: "#ea580c" }}> · terlambat</span>
          ) : null}
          {block.editLabel ? (
            <span style={{ color: "#9a3412" }}>
              {" "}
              · Diedit oleh {block.editLabel.editedByName ?? "—"},{" "}
              {fmtTime(block.editLabel.editedAt, tz)}
            </span>
          ) : null}
          {block.latitude ? (
            <span>
              {" "}
              · 📍{" "}
              <a
                href={`https://maps.google.com/?q=${block.latitude},${block.longitude}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent)" }}
              >
                lokasi
              </a>
            </span>
          ) : null}
        </p>

        <a
          href={`/reports/edit/${block.reportId}`}
          className="mt-1 inline-flex min-h-[30px] items-center rounded-md border px-2 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--accent)" }}
        >
          Lihat / Edit
        </a>

        {block.phaseNote ? (
          <div
            className="mt-2 rounded-md px-2 py-1.5"
            style={{ background: "var(--bg)", borderLeft: "3px solid var(--accent)" }}
          >
            <p className="text-[11px] font-medium" style={{ color: "var(--muted)" }}>
              {block.phase === "closing" ? "Laporan Akhir Hari" : "Laporan Awal Hari"}
            </p>
            <p className="text-sm whitespace-pre-wrap">{block.phaseNote}</p>
          </div>
        ) : null}

        {block.handoverNote ? <p className="mt-2 whitespace-pre-wrap text-sm"><strong>Handover laporan ini:</strong> {block.handoverNote}</p> : null}
        {block.notes ? <p className="mt-1 text-sm whitespace-pre-wrap">{block.notes}</p> : null}

        <ReportChecklist reportId={block.reportId} phase={title} results={block.results} canReview={canReview} canEdit={block.canEdit} timezone={tz} issueContext={canCreateIssue ? { projectId, dayId, phase: block.phase } : undefined} />

        <ReportGeneralPhotos photos={block.photos} reportId={block.reportId} canReview={canReview} canEdit={block.canEdit} timezone={tz}/>
      </div>
    </section>
  );
}

export default async function DayDetailPage({ params,searchParams }: { params: Promise<{ id: string }>;searchParams:Promise<{reviewError?:string}> }) {
  const session = await requireUser();
  const { id } = await params;
  const {reviewError}=await searchParams;
  const db = getDb();

  // The route param is the project_day id; resolve its project for the loader.
  const day = await db.select().from(projectDays).where(eq(projectDays.id, id)).get();
  if (!day) notFound();

  const detail = await getDayDetail(db, session.user, day.projectId, day.date);
  if (!detail) notFound();

  const tz = detail.project.timezone;
  const galleryByPhase = (phase: string) => detail.gallery.filter((g) => g.phase === phase);
  const historyHref = detail.canViewIssues
    ? `/projects/${detail.project.id}?tab=days`
    : `/reports?${new URLSearchParams({ projectId: detail.project.id, from: detail.day.date, to: detail.day.date })}`;

  return (
    <AppShell>
      {/* Desktop: content on the left, review + export pinned in a right rail so
          a reviewer can read the day and act on it without scrolling to the end. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-6">
      <div className="min-w-0">
      <header className="mb-4">
        <Link href={historyHref} className="text-xs" style={{ color: "var(--muted)" }}>
          ← Riwayat laporan
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{detail.project.name}</h1>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {detail.day.date} · {detail.project.venue}
          {detail.day.dayType !== "event" ? ` · ${detail.day.dayType}` : ""}
        </p>

        {/* §7.2 no.1: headline numbers */}
        <dl
          className="mt-2 grid grid-cols-3 gap-2 rounded-xl border px-3 py-2 text-center text-xs lg:mt-4 lg:px-5 lg:py-3 xl:grid-cols-6 xl:gap-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <div>
            <dt style={{ color: "var(--muted)" }}>Checklist OK</dt>
            <dd className="text-base font-semibold">
              {detail.summary.checklistOkPct === null ? "—" : `${detail.summary.checklistOkPct}%`}
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Foto</dt>
            <dd className="text-base font-semibold">{detail.summary.photoCount}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Issue terbuka</dt>
            <dd
              className="text-base font-semibold"
              style={{ color: detail.summary.issuesOpen > 0 ? "#dc2626" : undefined }}
            >
              <Link href={`/issues?projectId=${detail.project.id}&open=1`} aria-label={`Lihat ${detail.summary.issuesOpen} issue belum ditutup`}>{detail.summary.issuesOpen} ↗</Link>
            </dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>NOT OK</dt>
            <dd className="font-semibold">{detail.summary.notOkCount}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Monitoring</dt>
            <dd className="font-semibold">{detail.summary.monitoringCount}</dd>
          </div>
          <div>
            <dt style={{ color: "var(--muted)" }}>Issue baru</dt>
            <dd className="font-semibold">{detail.summary.issuesNew}</dd>
          </div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Link href={`/projects/${detail.project.id}?tab=checklist`} className="inline-flex min-h-tap items-center rounded-lg border px-3" style={{ borderColor: "var(--border)", color: "var(--accent)" }}>Lihat seluruh checklist project →</Link>
          <a href="#report-checklists" className="inline-flex min-h-tap items-center rounded-lg border px-3" style={{ borderColor: "var(--border)", color: "var(--accent)" }}>Lihat checklist yang sudah diisi ↓</a>
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>Semua jawaban checklist ditampilkan per laporan di bawah. Klik judul checklist untuk meringkas. Klik foto untuk memperbesar.</p>
      </header>

      {detail.handoverFromPrevious ? (
        <div
          className="mb-4 rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Catatan handover dari hari sebelumnya
          </p>
          <p className="text-sm whitespace-pre-wrap">{detail.handoverFromPrevious}</p>
        </div>
      ) : null}

      {reviewError?<p role="alert" className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Laporan baru berubah. Periksa isi terbaru, lalu review ulang.</p>:null}
      <div id="report-checklists" className="scroll-mt-5" />
      {detail.openingReports.length ? detail.openingReports.map((block,index)=><ReportSection key={block.reportId} title={`Opening ${index+1} dari ${detail.openingReports.length}`} block={block} tz={tz} projectId={detail.project.id} dayId={detail.day.id} canReview={detail.canReview} canCreateIssue={detail.canCreateIssue}/>) : <ReportSection title="Opening" block={null} tz={tz} projectId={detail.project.id} dayId={detail.day.id} canReview={detail.canReview} canCreateIssue={detail.canCreateIssue}/>}
      {detail.monitoring.map((block,index)=><ReportSection key={block.reportId} title={`Monitoring ${index+1} dari ${detail.monitoring.length}`} block={block} tz={tz} projectId={detail.project.id} dayId={detail.day.id} canReview={detail.canReview} canCreateIssue={detail.canCreateIssue}/>)}
      {detail.closingReports.length ? detail.closingReports.map((block,index)=><ReportSection key={block.reportId} title={`Closing ${index+1} dari ${detail.closingReports.length}`} block={block} tz={tz} projectId={detail.project.id} dayId={detail.day.id} canReview={detail.canReview} canCreateIssue={detail.canCreateIssue}/>) : <ReportSection title="Closing" block={null} tz={tz} projectId={detail.project.id} dayId={detail.day.id} canReview={detail.canReview} canCreateIssue={detail.canCreateIssue}/>}

      {detail.day.handoverNote ? (
        <div
          className="mb-4 rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Catatan untuk besok (handover)
          </p>
          <p className="text-sm whitespace-pre-wrap">{detail.day.handoverNote}</p>
        </div>
      ) : null}

      {/* §7.2 no.5: issues */}
      {detail.issues.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Issues ({detail.issues.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {detail.issues.map((i) => (
              <li
                key={i.id}
                className="rounded-lg border px-3 py-2"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <div style={{ color: "var(--fg)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {i.code}
                  </p>
                  <p className="text-sm font-medium">{i.title}</p>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Pill label={severityLabel[i.severity as keyof typeof severityLabel]} tone={SEVERITY_TONE[i.severity]} />
                    <Pill label={issueStatusLabel[i.status as keyof typeof issueStatusLabel]} tone={STATUS_TONE[i.status]} />
                  </span>
                  {detail.canViewIssues ? <Link href={`/issues/${i.id}`} className="mt-1 block text-xs text-[var(--accent)]">Buka detail &amp; tindak lanjut →</Link> : null}
                </div>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Next step: {i.nextStep}
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  PIC: {i.picName ?? i.picExternal ?? "—"} · oleh {i.authorName} ({i.authorRole})
                </p>
                <PhotoGallery small photos={i.photoIds.map((id, index) => ({ id, label: `Foto issue ${i.code} ${index + 1}`, caption: i.title }))} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* §7.2 no.6: gallery */}
      {detail.gallery.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Galeri hari ini ({detail.gallery.length})
          </h2>
          {(["opening", "monitoring", "closing"] as const).map((phase) => {
            const photos = galleryByPhase(phase);
            if (photos.length === 0) return null;
            return (
              <div key={phase} className="mb-2">
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {phase} ({photos.length})
                </p>
                <PhotoGrid photos={photos} />
              </div>
            );
          })}
        </section>
      ) : null}

      </div>{/* /main column */}

      <aside className="lg:sticky lg:top-8 lg:flex lg:flex-col">
      {/* §7.5: PDF export */}
      {detail.canExport ? (
        <section className="mb-6">
          <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Export
          </h2>
          <div
            className="rounded-xl border px-4 py-3"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <ExportPdfForm
              action={exportDailyPdfAction}
              hidden={{ projectDayId: detail.day.id }}
              submitLabel="Export PDF laporan harian"
              hint="Satu hari per PDF."
            />
          </div>
        </section>
      ) : null}

      {/* §7.2 no.7: review panel. On desktop this is the primary action, so it
          sits at the top of the rail (DOM order is kept for mobile). */}
      <section className="mb-6 lg:order-first">
        <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
          Review
        </h2>
        <div
          className="rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          {detail.day.reviewedAt ? (
            <>
              <p className="text-sm" style={{ color: "#166534" }}>
                ✓ Direview oleh {detail.day.reviewedByName ?? "—"} ·{" "}
                {new Date(detail.day.reviewedAt).toLocaleString("id-ID")}
              </p>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                Laporan tetap bisa diedit sesuai hak akses. Riwayat perubahan tetap tercatat.
              </p>
              {detail.day.changedSinceReview ? <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-800">Ada perubahan setelah review</p> : null}
              {detail.canReview && detail.day.changedSinceReview ? <form action={markReviewedAction} className="mt-2"><input type="hidden" name="projectDayId" value={detail.day.id}/><input type="hidden" name="reviewVersion" value={detail.day.reviewVersion}/><button className="btn-primary text-xs">Review ulang</button></form> : null}
              {detail.canUnreview ? (
                <form action={unmarkReviewedAction} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="projectDayId" value={detail.day.id} />
                  <input
                    name="reason"
                    required
                    placeholder="Alasan membatalkan review (wajib)"
                    aria-label="Alasan membatalkan review"
                    className="min-h-tap rounded-lg border px-3 text-sm"
                    style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
                  />
                  <button
                    type="submit"
                    className="min-h-tap rounded-lg border px-4 py-2 text-sm"
                    style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                  >
                    Batalkan review
                  </button>
                </form>
              ) : null}
            </>
          ) : detail.canReview ? (
            <form action={markReviewedAction}>
              <input type="hidden" name="projectDayId" value={detail.day.id} /><input type="hidden" name="reviewVersion" value={detail.day.reviewVersion}/>
              <button
                type="submit"
                className="min-h-tap w-full rounded-lg px-4 py-3 text-base font-medium text-white"
                style={{ background: "var(--accent-solid)" }}
              >
                Mark as Reviewed
              </button>
            </form>
          ) : (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Belum direview.
            </p>
          )}

          {detail.comments.length > 0 ? <p className="mt-4 text-xs font-medium text-[var(--muted)]">Riwayat komentar umum sebelumnya</p> : null}
          {detail.comments.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1">
              {detail.comments.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md px-2 py-1.5 text-sm"
                  style={{ background: "var(--bg)" }}
                >
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {c.authorName} ({c.authorRole}) · {new Date(c.createdAt).toLocaleString("id-ID")}
                  </p>
                  <p className="whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="mt-3 text-xs text-[var(--muted)]">Berikan review langsung pada poin checklist yang perlu diperiksa.</p>
        </div>
      </section>
      </aside>
      </div>{/* /grid */}
    </AppShell>
  );
}
