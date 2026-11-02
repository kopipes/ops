import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import {
  issues,
  projectDays,
  projects,
  reports,
} from "@/server/db/schema";
import { visibleProjectIds } from "@/server/visibility";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { toLocalDate, toLocalTime } from "@/lib/datetime";
import { isPhaseOverdue } from "@/server/services/reports";
import { loadFacts } from "@/server/services/projects";
import { canSubmitPhase } from "@/server/permissions";

/** §4.2: which phase should the primary button target right now? */
function primaryPhase(project: {
  openingWindowStart: string;
  openingWindowEnd: string;
  closingWindowStart: string;
  closingWindowEnd: string;
  timezone: string;
}): "opening" | "monitoring" | "closing" {
  const now = Date.now();
  const t = toLocalTime(now, project.timezone);
  if (t < project.openingWindowEnd) return "opening";
  if (t >= project.closingWindowStart) return "closing";
  return "monitoring";
}

const PHASE_BUTTON: Record<string, string> = {
  opening: "Isi Opening",
  monitoring: "+ Laporan Monitoring",
  closing: "Isi Closing",
};

export default async function HomePage() {
  const session = await requireUser();
  const db = getDb();

  const ids = await visibleProjectIds(db, session.user);
  const activeProjects =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(projects)
          .where(and(inArray(projects.id, ids), eq(projects.status, "active"), isNull(projects.deletedAt)));

  // For each project, gather today's day + report status.
  const cards = await Promise.all(
    activeProjects.map(async (p) => {
      const today = toLocalDate(Date.now(), p.timezone);

      const day = await db
        .select()
        .from(projectDays)
        .where(and(eq(projectDays.projectId, p.id), eq(projectDays.date, today)))
        .get();

      const facts = await loadFacts(db, p.id);

      let opening: { submittedAt: number | null; isLate: boolean; by: string | null } | null = null;
      let closing = false;
      let monitoring = 0;

      if (day) {
        const rows = await db
          .select({
            phase: reports.phase,
            status: reports.status,
            submittedAt: reports.submittedAt,
            isLate: reports.isLate,
          })
          .from(reports)
          .where(
            and(
              eq(reports.projectDayId, day.id),
              isNull(reports.deletedAt),
              eq(reports.status, "submitted"),
            ),
          );

        const op = rows.find((r) => r.phase === "opening");
        if (op) opening = { submittedAt: op.submittedAt, isLate: Boolean(op.isLate), by: null };
        closing = rows.some((r) => r.phase === "closing");
        monitoring = rows.filter((r) => r.phase === "monitoring").length;
      }

      const openIssueRows = await db
        .select({ id: issues.id, severity: issues.severity })
        .from(issues)
        .where(and(eq(issues.projectId, p.id), isNull(issues.deletedAt), ne(issues.status, "closed")));

      const openingOverdue =
        day && !opening ? isPhaseOverdue("opening", day.date, p, Date.now()) : false;

      const phase = primaryPhase(p);
      const canSubmit = day
        ? canSubmitPhase(session.user, facts, phase === "opening" || phase === "closing" ? phase : "monitoring", day.assignedUserId)
        : false;

      return {
        project: p,
        today,
        day,
        opening,
        closing,
        monitoring,
        openIssues: openIssueRows.length,
        highIssues: openIssueRows.filter((i) => i.severity === "high" || i.severity === "critical")
          .length,
        openingOverdue,
        phase,
        canSubmit,
      };
    }),
  );

  return (
    <AppShell>
      <header className="mb-5">
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Halo,
        </p>
        <h1 className="text-xl font-semibold">{session.name}</h1>
      </header>

      <section aria-labelledby="today-heading">
        <h2 id="today-heading" className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
          Hari ini
        </h2>

        {cards.length === 0 ? (
          <p
            className="rounded-xl border px-4 py-6 text-center text-sm"
            style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
          >
            Belum ada project aktif yang bisa kamu akses.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {cards.map((c) => (
              <li
                key={c.project.id}
                className="rounded-xl border px-4 py-3"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{c.project.name}</p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {c.project.venue} · {c.today}
                    </p>
                  </div>
                  {c.openingOverdue ? (
                    <span
                      className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                      style={{ background: "#fee2e2", color: "#991b1b" }}
                    >
                      Terlambat
                    </span>
                  ) : null}
                </div>

                <ul className="mt-2 flex flex-col gap-0.5 text-sm">
                  <li className="flex justify-between">
                    <span style={{ color: "var(--muted)" }}>Opening</span>
                    <span>
                      {c.opening
                        ? `${c.opening.submittedAt ? toLocalTime(c.opening.submittedAt, c.project.timezone) : "✓"} ✓${
                            c.opening.isLate ? " · terlambat" : ""
                          }`
                        : "belum"}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span style={{ color: "var(--muted)" }}>Monitoring</span>
                    <span>{c.monitoring} laporan</span>
                  </li>
                  <li className="flex justify-between">
                    <span style={{ color: "var(--muted)" }}>Closing</span>
                    <span>{c.closing ? "✓" : "belum"}</span>
                  </li>
                  {c.openIssues > 0 ? (
                    <li className="flex justify-between">
                      <span style={{ color: "#991b1b" }}>
                        {c.openIssues} issue terbuka
                        {c.highIssues > 0 ? ` (${c.highIssues} High)` : ""}
                      </span>
                    </li>
                  ) : null}
                </ul>

                {c.day && c.canSubmit ? (
                  <Link
                    href={`/projects/${c.project.id}/days/${c.today}/${c.phase}`}
                    className="mt-3 flex min-h-tap items-center justify-center rounded-lg px-4 py-2 text-sm font-medium text-white"
                    style={{ background: "var(--accent)" }}
                  >
                    {PHASE_BUTTON[c.phase]}
                  </Link>
                ) : null}

                <div className="mt-2 flex gap-2">
                  <Link
                    href={`/projects/${c.project.id}?tab=today`}
                    className="flex min-h-[36px] flex-1 items-center justify-center rounded-lg border text-xs"
                    style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                  >
                    Detail hari
                  </Link>
                  {c.day ? (
                    <Link
                      href={`/projects/${c.project.id}/days/${c.today}/monitoring`}
                      className="flex min-h-[36px] flex-1 items-center justify-center rounded-lg border text-xs"
                      style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                    >
                      + Monitoring
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
