import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { PhotoGallery } from "@/components/reports/PhotoGallery";
import { EditReportForm } from "@/components/crew/EditReportForm";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getEditableReport, listReportRevisions } from "@/server/services/report-edits";
import { editReportAction } from "@/app/edit-actions";
import { formatReportTimestamp } from "@/lib/datetime";

export const metadata = { title: "Edit Laporan — Pulse" };

const RESULT_LABEL: Record<string, string> = { ok: "OK", not_ok: "Tidak OK", na: "N/A" };

export default async function EditReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;
  const { saved } = await searchParams;
  const db = getDb();

  const loaded = await getEditableReport(db, session.user, id);
  if (!loaded) notFound();

  const revisions = await listReportRevisions(db, id);
  const { report, canEdit, editBlockedReason } = loaded;

  return (
    <AppShell contentWidth="form">
      <header className="mb-4">
        <Link href={`/reports/day/${report.projectDayId}`} className="text-xs" style={{ color: "var(--muted)" }}>
          ← Report
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Edit Laporan {report.phase}</h1>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Diisi oleh {report.submittedByName ?? "—"}
          {report.submittedAt
            ? ` · Waktu pengisian: ${formatReportTimestamp(report.submittedAt, report.timezone)}`
            : ""}
        </p>

        {/* §9.5 no.4: "Diedit oleh…" */}
        {report.editCount > 0 ? (
          <p className="mt-1 text-xs" style={{ color: "#9a3412" }}>
            Diedit oleh {report.lastEditedByName ?? "—"}
            {report.lastEditedAt ? `, ${formatReportTimestamp(report.lastEditedAt, report.timezone)}` : ""} ·{" "}
            {report.editCount}×
          </p>
        ) : null}
      </header>

      {saved ? (
        <p
          role="status"
          className="mb-3 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--border)", color: "#166534" }}
        >
          Perubahan tersimpan.
        </p>
      ) : null}

      {canEdit ? (
        <EditReportForm
          action={editReportAction}
          reportId={report.id}
          generalPhotos={report.generalPhotos}
          projectId={report.projectId}
          projectDayId={report.projectDayId}
          updatedAt={report.updatedAt}
          notes={report.notes}
          phase={report.phase}
          timezone={report.timezone}
          phaseNote={report.phaseNote}
          handoverNote={report.handoverNote}
          observedTime={new Intl.DateTimeFormat("en-GB",{timeZone:report.timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(report.observedAt))}
          results={report.results}
        />
      ) : (
        <p
          className="mb-4 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "#dc2626", color: "#dc2626", background: "var(--surface)" }}
        >
          {editBlockedReason ?? "Laporan ini tidak bisa diedit."}
        </p>
      )}

      {!canEdit?<PhotoGallery photos={report.photoIds.map((id,index)=>({id,label:`Foto laporan ${index+1}`}))} />:null}

      {/* §9.5 no.4: "Lihat riwayat" */}
      {revisions.length > 0 ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Riwayat versi ({revisions.length})
          </h2>
          <ol className="flex flex-col gap-2">
            {revisions.map((rev, i) => (
              <li
                key={rev.id}
                className="rounded-lg border px-3 py-2"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  Versi {i + 1} · {rev.editedByName ?? "—"} ·{" "}
                  {formatReportTimestamp(rev.createdAt, report.timezone)}
                </p>

                {rev.changes.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                    {rev.changes.map((c, k) => (
                      <li key={`${c.projectChecklistItemId}-${c.field}-${k}`} style={{ color: "var(--muted)" }}>
                        {c.label} · {c.field === "result" ? "hasil" : c.field === "observedAt" ? "waktu" : "catatan"}:{" "}
                        <span style={{ color: "#991b1b" }}>
                          {c.field === "result" ? (RESULT_LABEL[c.from ?? ""] ?? c.from ?? "—") : c.field === "observedAt" ? formatReportTimestamp(Number(c.from),report.timezone) : (c.from ?? "—")}
                        </span>{" "}
                        →{" "}
                        <span style={{ color: "#166534" }}>
                          {c.field === "result" ? (RESULT_LABEL[c.to ?? ""] ?? c.to ?? "—") : c.field === "observedAt" ? formatReportTimestamp(Number(c.to),report.timezone) : (c.to ?? "—")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <details className="mt-1">
                  <summary className="cursor-pointer text-xs" style={{ color: "var(--muted)" }}>
                    Lihat isi versi ini
                  </summary>
                  <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    <p>Catatan umum: {rev.snapshot.notes ?? "—"}</p>
                    {rev.snapshot.observedAt ? <p>Waktu kejadian: {formatReportTimestamp(rev.snapshot.observedAt,report.timezone)}</p>:null}
                    {rev.snapshot.phaseNote ? <p>Isi laporan: {rev.snapshot.phaseNote}</p>:null}
                    {rev.snapshot.handoverNote ? <p>Handover: {rev.snapshot.handoverNote}</p>:null}
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {rev.snapshot.results.map((r, k) => (
                        <li key={`${r.label}-${k}`}>
                          {RESULT_LABEL[r.result] ?? r.result} — {r.label}
                          {r.note ? ` (${r.note})` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </AppShell>
  );
}
