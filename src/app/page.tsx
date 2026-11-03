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
import { loadProjectFacts, visibleProjectIds } from "@/server/visibility";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { toLocalDate, toLocalTime } from "@/lib/datetime";
import { isPhaseOverdue } from "@/server/services/reports";
import { canSubmitPhase } from "@/server/permissions";
import { getGlobalSettings, type GlobalSettings } from "@/server/services/app-settings";
import { LiveSearchFilters } from "@/components/LiveSearchFilters";
import { normalizeSearch, textSearch } from "@/server/search";

/** §4.2: which phase should the primary button target right now? */
function primaryPhase(project: {
  openingWindowStart: string;
  openingWindowEnd: string;
  closingWindowStart: string;
  closingWindowEnd: string;
  timezone: string;
}, settings: GlobalSettings, openingSubmitted: boolean): "opening" | "monitoring" | "closing" {
  const now = Date.now();
  const t = toLocalTime(now, project.timezone);
  if (settings.closingWindowEnabled && t >= project.closingWindowStart) return "closing";
  if (!openingSubmitted && (!settings.openingWindowEnabled || t < project.openingWindowEnd)) return "opening";
  return "monitoring";
}

const PHASE_BUTTON: Record<string, string> = {
  opening: "Isi Opening",
  monitoring: "+ Laporan Monitoring",
  closing: "Isi Closing",
};

export default async function HomePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeSearch((await searchParams).q);
  const session = await requireUser();
  const db = getDb();
  const settings = await getGlobalSettings(db);

  const ids = await visibleProjectIds(db, session.user);
  const activeProjects =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(projects)
          .where(and(inArray(projects.id, ids), eq(projects.status, "active"), isNull(projects.deletedAt), textSearch(query, projects.name, projects.code, projects.venue, projects.client)));

  // Fetch today's data in batches: query count stays constant as projects grow.
  // Dates are resolved per project so teams in different timezones stay correct.
  const now = Date.now();
  const activeIds = activeProjects.map(p => p.id);
  const dates = new Map(activeProjects.map(p => [p.id, toLocalDate(now, p.timezone)]));
  const [dayRows, factsByProject, openIssueRows] = activeIds.length
    ? await Promise.all([
        db.select().from(projectDays).where(and(
          inArray(projectDays.projectId, activeIds),
          inArray(projectDays.date, [...new Set(dates.values())]),
        )),
        loadProjectFacts(db, activeIds),
        db.select({ projectId: issues.projectId, severity: issues.severity }).from(issues).where(and(
          inArray(issues.projectId, activeIds),
          isNull(issues.deletedAt),
          ne(issues.status, "closed"),
        )),
      ])
    : [[], new Map(), []];
  const daysByProject = new Map(dayRows.filter(d => dates.get(d.projectId) === d.date).map(d => [d.projectId, d]));
  const dayIds = [...daysByProject.values()].map(d => d.id);
  const reportRows = dayIds.length
    ? await db.select({
        projectDayId: reports.projectDayId,
        phase: reports.phase,
        submittedAt: reports.submittedAt,
        isLate: reports.isLate,
      }).from(reports).where(and(
        inArray(reports.projectDayId, dayIds),
        isNull(reports.deletedAt),
        eq(reports.status, "submitted"),
      ))
    : [];
  const reportsByDay = new Map<string, typeof reportRows>();
  for (const row of reportRows) {
    const rows = reportsByDay.get(row.projectDayId) ?? [];
    rows.push(row);
    reportsByDay.set(row.projectDayId, rows);
  }
  const issueCounts = new Map<string, { open: number; high: number }>();
  for (const issue of openIssueRows) {
    const counts = issueCounts.get(issue.projectId) ?? { open: 0, high: 0 };
    counts.open++;
    if (issue.severity === "high" || issue.severity === "critical") counts.high++;
    issueCounts.set(issue.projectId, counts);
  }
  const cards = activeProjects.map((p) => {
      const today = dates.get(p.id)!;
      const day = daysByProject.get(p.id);
      const facts = factsByProject.get(p.id);

      let opening: { submittedAt: number | null; isLate: boolean; by: string | null } | null = null;
      let closing = false;
      let monitoring = 0;

      if (day) {
        const rows = reportsByDay.get(day.id) ?? [];

        const op = rows.find((r) => r.phase === "opening");
        if (op) opening = { submittedAt: op.submittedAt, isLate: Boolean(op.isLate), by: null };
        closing = rows.some((r) => r.phase === "closing");
        monitoring = rows.filter((r) => r.phase === "monitoring").length;
      }

      const openingOverdue =
        day && !opening ? isPhaseOverdue("opening", day.date, p, now, settings) : false;

      const phase = primaryPhase(p, settings, opening !== null);
      const canSubmit = day && facts
        ? canSubmitPhase(session.user, facts, phase === "opening" || phase === "closing" ? phase : "monitoring", day.assignedUserId)
        : false;

      return {
        project: p,
        today,
        day,
        opening,
        closing,
        monitoring,
        openIssues: issueCounts.get(p.id)?.open ?? 0,
        highIssues: issueCounts.get(p.id)?.high ?? 0,
        openingOverdue,
        phase,
        canSubmit,
        canFillClosing: Boolean(day && facts && !day.reviewedAt && canSubmitPhase(session.user, facts, "closing", day.assignedUserId)),
      };
    });

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

        <LiveSearchFilters placeholder="Cari project hari ini" />
        {cards.length === 0 ? (
          <p
            className="rounded-xl border px-4 py-6 text-center text-sm"
            style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
          >
            {query ? "Tidak ada project hari ini yang cocok dengan pencarian." : "Belum ada project aktif yang bisa kamu akses."}
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <li
                key={c.project.id}
                className="flex flex-col rounded-xl border px-4 py-3"
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
                            c.opening.isLate && settings.openingWindowEnabled ? " · terlambat" : ""
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
                      <Link href={`/issues?projectId=${c.project.id}&open=1`} className="underline underline-offset-2" style={{ color: "#991b1b" }}>
                        {c.openIssues} issue terbuka
                        {c.highIssues > 0 ? ` (${c.highIssues} High/Critical)` : ""}
                      </Link>
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

                <div className="mt-auto flex gap-2 pt-2">
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
                  {c.day && !c.closing && !settings.closingWindowEnabled && c.canFillClosing ? (
                    <Link
                      href={`/projects/${c.project.id}/days/${c.today}/closing`}
                      className="flex min-h-[36px] flex-1 items-center justify-center rounded-lg border text-xs"
                      style={{ borderColor: "var(--border)", color: "var(--accent)" }}
                    >
                      Isi Closing
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
