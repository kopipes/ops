import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ReportForm } from "@/components/crew/ReportForm";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { isReportOnlyProjectMember } from "@/server/permissions";
import { checklistEditVersion } from "@/server/services/project-checklist-editor";
import { loadDayPageContext } from "@/server/services/day-context";
import { listPhaseReports, type Phase } from "@/server/services/reports";
import { formatReportTimestamp, toLocalDate } from "@/lib/datetime";
import { submitReportAction } from "@/app/report-actions";

const PHASE_LABEL: Record<Phase, string> = {
  opening: "Opening",
  monitoring: "Monitoring",
  closing: "Closing",
};

/**
 * Shared renderer for the three crew report pages.
 * Read-only mode is applied when the user may view but not submit (§4.6).
 */
export async function CrewReportPage({
  projectId,
  date,
  phase,
}: {
  projectId: string;
  date: string;
  phase: Phase;
}) {
  const session = await requireUser();
  const db = getDb();

  const ctx = await loadDayPageContext(db, session.user, {
    projectId,
    date,
    phase,
  });
  if (!ctx) notFound();
  if (isReportOnlyProjectMember(session.user, ctx.facts)) redirect(`/reports/day/${ctx.day.id}`);

  const history = await listPhaseReports(db, ctx.day.id, phase);
  const readOnly = !ctx.canSubmit;
  const returnTab = date === toLocalDate(Date.now(), ctx.project.timezone) ? "today" : "days";

  let readOnlyReason: string | undefined;
  if (!ctx.canSubmit) {
    readOnlyReason =
      phase === "monitoring"
        ? "Kamu bukan member project ini."
        : "Hanya Head Crew, petugas hari ini, Manager, atau Admin yang bisa mengisi fase ini.";
  }

  const monitoringCount = history.length;

  return (
    <AppShell>
      {/* A form is hard to scan at full desktop width — keep it to a readable column. */}
      <div className="lg:max-w-3xl">
      <header className="mb-4">
        <Link
          href={`/projects/${projectId}?tab=${returnTab}`}
          className="text-xs"
          style={{ color: "var(--muted)" }}
        >
          ← {ctx.project.name}
        </Link>
        <div className="mt-1 flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">{PHASE_LABEL[phase]}</h1>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {ctx.day.date} · {ctx.day.dayType}
              {ctx.day.isOutOfRange ? " · di luar rentang" : ""}
            </p>
          </div>
          {ctx.overdue && history.length === 0 ? (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: "#fee2e2", color: "#991b1b" }}
            >
              Terlambat
            </span>
          ) : null}
        </div>
      </header>

      {history.length > 0 ? <section className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Laporan {PHASE_LABEL[phase]} ({history.length})</h2>{!readOnly ? <a href="#form-laporan" className="btn-secondary text-xs">+ Tambah laporan {PHASE_LABEL[phase]}</a> : null}</div>
        <ol className="mt-3 flex flex-col gap-3">{history.map((report,index)=><li key={report.id} className="rounded-lg border border-[var(--border)] p-3">
          <p className="text-sm font-medium">Laporan {index+1} · {report.submittedByName ?? "—"}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">Waktu kejadian: {formatReportTimestamp(report.observedAt,ctx.project.timezone)}<br/>Waktu pengisian: {formatReportTimestamp(report.submittedAt,ctx.project.timezone)}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm">{report.phaseNote || report.notes || "Laporan checklist"}</p>
          <a href={`/reports/edit/${report.id}`} className="mt-2 inline-flex min-h-tap items-center text-xs text-[var(--accent)]">Lihat / Edit laporan {index+1}</a>
        </li>)}</ol>
      </section> : null}
      <div id="form-laporan" className="scroll-mt-4" />
      <ReportForm
        action={submitReportAction}
        ownerId={session.user.id}
        phase={phase}
        projectId={projectId}
        projectDayId={ctx.day.id}
        dayDate={ctx.day.date}
        defaultObservedTime={new Intl.DateTimeFormat("en-GB",{timeZone:ctx.project.timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date())}
        timezone={ctx.project.timezone}
        items={ctx.items}
        checklistVersion={checklistEditVersion(ctx.items)}
        readOnly={readOnly}
        readOnlyReason={readOnlyReason}
        existing={
          readOnly && ctx.existing
            ? {
                reportId: ctx.existing.reportId,
                submittedByName: ctx.existing.submittedByName,
                submittedAt: ctx.existing.submittedAt,
                isLate: ctx.existing.isLate && ctx.windowEnabled,
                notes: ctx.existing.notes,
                phaseNote: ctx.existing.phaseNote,
                handoverNote: ctx.existing.handoverNote,
                latitude: ctx.existing.latitude,
                longitude: ctx.existing.longitude,
                locationAccuracyM: ctx.existing.locationAccuracyM,
                results: ctx.existing.results.map((r) => ({
                  label: r.label,
                  categoryName: r.categoryName,
                  result: r.result,
                  note: r.note,
                })),
              }
            : null
        }
        monitoringCount={monitoringCount}
        carryOverIssues={ctx.carryOverIssues}
        handoverFromYesterday={ctx.handoverFromYesterday}
      />
      </div>
    </AppShell>
  );
}

export function phaseMetadata(phase: Phase) {
  return { title: `${PHASE_LABEL[phase]} — Pulse` };
}
