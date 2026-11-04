import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ReportForm } from "@/components/crew/ReportForm";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { loadDayPageContext } from "@/server/services/day-context";
import { listMonitoringReports, type Phase } from "@/server/services/reports";
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

  // §4.6: only one live opening/closing per day; if it exists, show it read-only.
  const alreadySubmitted = phase !== "monitoring" && ctx.existing !== null;
  // §13.1: a reviewed day is locked for everyone.
  const reviewed = ctx.reviewedAt !== null;
  const readOnly = !ctx.canSubmit || alreadySubmitted || reviewed;

  let readOnlyReason: string | undefined;
  if (reviewed) {
    readOnlyReason = `Hari ini sudah direview oleh ${ctx.reviewedByName ?? "reviewer"}. Laporan tidak bisa diubah (§13.1).`;
  } else if (alreadySubmitted) {
    readOnlyReason = `Laporan ${PHASE_LABEL[phase]} hari ini sudah diisi. Satu laporan per hari.`;
  } else if (!ctx.canSubmit) {
    readOnlyReason =
      phase === "monitoring"
        ? "Kamu bukan member project ini."
        : "Hanya Head Crew, petugas hari ini, Manager, atau Admin yang bisa mengisi fase ini.";
  }

  const monitoringCount =
    phase === "monitoring" ? (await listMonitoringReports(db, ctx.day.id)).length : 0;

  return (
    <AppShell>
      {/* A form is hard to scan at full desktop width — keep it to a readable column. */}
      <div className="lg:max-w-3xl">
      <header className="mb-4">
        <Link
          href={`/projects/${projectId}?tab=today`}
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
          {ctx.overdue && !alreadySubmitted ? (
            <span
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
              style={{ background: "#fee2e2", color: "#991b1b" }}
            >
              Terlambat
            </span>
          ) : null}
        </div>
      </header>

      <ReportForm
        action={submitReportAction}
        phase={phase}
        projectId={projectId}
        projectDayId={ctx.day.id}
        dayDate={ctx.day.date}
        timezone={ctx.project.timezone}
        items={ctx.items}
        readOnly={readOnly}
        readOnlyReason={readOnlyReason}
        existing={
          ctx.existing
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
