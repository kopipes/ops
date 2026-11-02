import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getDayDetail, type GalleryPhoto, type ReportBlock } from "@/server/services/reports-review";
import { eq } from "drizzle-orm";
import { projectDays } from "@/server/db/schema";
import { dayCommentAction, markReviewedAction, unmarkReviewedAction } from "@/app/review-actions";
import { DayCommentForm } from "@/components/review/DayCommentForm";
import { ExportPdfForm } from "@/components/pdf/ExportPdfForm";
import { exportDailyPdfAction } from "@/app/pdf-actions";

export const metadata = { title: "Detail Hari — Ops" };

const RESULT_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  not_ok: { bg: "#fee2e2", fg: "#991b1b", label: "Tidak OK" },
  na: { bg: "#e2e8f0", fg: "#334155", label: "N/A" },
  ok: { bg: "#dcfce7", fg: "#166534", label: "OK" },
};

function fmtTime(at: number | null, tz: string) {
  if (!at) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(at));
}

function PhotoGrid({ photos }: { photos: GalleryPhoto[] }) {
  if (photos.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {photos.map((p) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={p.id}
          src={`/api/photos/${p.id}?v=thumb`}
          alt={`Foto ${p.phase ?? ""}`}
          className="h-16 w-16 rounded object-cover"
          loading="lazy"
        />
      ))}
    </div>
  );
}

function ReportSection({
  title,
  block,
  tz,
  collapsibleOk = false,
}: {
  title: string;
  block: ReportBlock | null;
  tz: string;
  collapsibleOk?: boolean;
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
          Tidak diisi
        </p>
      </section>
    );
  }

  const anomalies = block.results.filter((r) => r.result !== "ok");
  const oks = block.results.filter((r) => r.result === "ok");

  return (
    <section className="mb-4">
      <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
        {title}
      </h2>
      <div
        className="rounded-lg border px-3 py-2"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {block.submittedByName ?? "—"} · {fmtTime(block.submittedAt, tz)}
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

        {block.notes ? <p className="mt-1 text-sm whitespace-pre-wrap">{block.notes}</p> : null}

        {/* §7.2: NOT_OK shown first and highlighted; OK collapsible. */}
        {anomalies.length > 0 ? (
          <ul className="mt-2 flex flex-col gap-1">
            {anomalies.map((r) => (
              <li
                key={r.id}
                className="rounded-md px-2 py-1.5 text-sm"
                style={{ background: RESULT_STYLE[r.result].bg, color: RESULT_STYLE[r.result].fg }}
              >
                <span className="text-[11px]">{RESULT_STYLE[r.result].label}</span>
                <p className="font-medium">{r.label}</p>
                {r.note ? <p className="text-xs">{r.note}</p> : null}
              </li>
            ))}
          </ul>
        ) : null}

        {oks.length > 0 ? (
          collapsibleOk ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs" style={{ color: "var(--muted)" }}>
                {oks.length} item OK
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5 text-xs" style={{ color: "var(--muted)" }}>
                {oks.map((r) => (
                  <li key={r.id}>✓ {r.label}</li>
                ))}
              </ul>
            </details>
          ) : (
            <ul className="mt-2 flex flex-col gap-0.5 text-xs" style={{ color: "var(--muted)" }}>
              {oks.map((r) => (
                <li key={r.id}>✓ {r.label}</li>
              ))}
            </ul>
          )
        ) : null}

        <PhotoGrid photos={block.photos} />
      </div>
    </section>
  );
}

export default async function DayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  const { id } = await params;
  const db = getDb();

  // The route param is the project_day id; resolve its project for the loader.
  const day = await db.select().from(projectDays).where(eq(projectDays.id, id)).get();
  if (!day) notFound();

  const detail = await getDayDetail(db, session.user, day.projectId, day.date);
  if (!detail) notFound();

  const tz = detail.project.timezone;
  const galleryByPhase = (phase: string) => detail.gallery.filter((g) => g.phase === phase);

  return (
    <AppShell>
      <header className="mb-4">
        <Link href="/reports" className="text-xs" style={{ color: "var(--muted)" }}>
          ← Report
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{detail.project.name}</h1>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {detail.day.date} · {detail.project.venue}
          {detail.day.dayType !== "event" ? ` · ${detail.day.dayType}` : ""}
        </p>

        {/* §7.2 no.1: headline numbers */}
        <dl
          className="mt-2 grid grid-cols-3 gap-2 rounded-xl border px-3 py-2 text-center text-xs"
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
              {detail.summary.issuesOpen}
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

      <ReportSection title="Opening" block={detail.opening} tz={tz} collapsibleOk />

      {detail.monitoring.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Monitoring ({detail.monitoring.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {detail.monitoring.map((m) => (
              <li
                key={m.reportId}
                className="rounded-lg border px-3 py-2"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {fmtTime(m.submittedAt, tz)} · {m.submittedByName ?? "—"}
                </p>
                <p className="text-sm whitespace-pre-wrap">{m.notes}</p>
                {m.results.filter((r) => r.result !== "ok").length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs" style={{ color: "#991b1b" }}>
                    {m.results
                      .filter((r) => r.result !== "ok")
                      .map((r) => (
                        <li key={r.id}>
                          {RESULT_STYLE[r.result].label}: {r.label}
                          {r.note ? ` — ${r.note}` : ""}
                        </li>
                      ))}
                  </ul>
                ) : null}
                <PhotoGrid photos={m.photos} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ReportSection title="Closing" block={detail.closing} tz={tz} collapsibleOk />

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
                <Link href={`/issues/${i.id}`} style={{ color: "var(--fg)" }}>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {i.code} · {i.severity} · {i.status}
                  </p>
                  <p className="text-sm font-medium">{i.title}</p>
                </Link>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Next step: {i.nextStep}
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  PIC: {i.picName ?? i.picExternal ?? "—"} · oleh {i.authorName} ({i.authorRole})
                </p>
                {i.photoIds.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {i.photoIds.map((pid) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={pid}
                        src={`/api/photos/${pid}?v=thumb`}
                        alt="Foto issue"
                        className="h-14 w-14 rounded object-cover"
                        loading="lazy"
                      />
                    ))}
                  </div>
                ) : null}
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

      {/* §7.5: PDF export */}
      {detail.canReview ? (
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

      {/* §7.2 no.7: review panel */}
      <section className="mb-6">
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
                Setelah direview, laporan tidak bisa diedit lagi (§13.1).
              </p>
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
              <input type="hidden" name="projectDayId" value={detail.day.id} />
              <button
                type="submit"
                className="min-h-tap w-full rounded-lg px-4 py-3 text-base font-medium text-white"
                style={{ background: "var(--accent)" }}
              >
                Mark as Reviewed
              </button>
            </form>
          ) : (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              Belum direview.
            </p>
          )}

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

          {detail.canReview ? (
            <DayCommentForm projectDayId={detail.day.id} action={dayCommentAction} />
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
