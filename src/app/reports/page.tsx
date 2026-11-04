import Link from "next/link";
import { asc, inArray } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { divisions, projects } from "@/server/db/schema";
import { getDailySummary } from "@/server/services/reports-review";
import { visibleProjectIds } from "@/server/visibility";
import { isAdmin, isCorporate, isManager } from "@/server/permissions";
import { getGlobalSettings } from "@/server/services/app-settings";
import { toLocalDate } from "@/lib/datetime";
import { Icon, MetricCard, PageHeader } from "@/components/ui/WorkspaceUI";

export const metadata = { title: "Report — Ops" };

const STATUS_FILTERS = [
  { key: "all", label: "Semua" },
  { key: "incomplete", label: "Belum lengkap" },
  { key: "critical", label: "Ada issue High/Critical" },
  { key: "unreviewed", label: "Belum direview" },
] as const;

function timeInZone(at: number | null, timeZone: string): string {
  if (!at) return "";
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    hour12: false,
  }).formatToParts(new Date(at));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
  return `${part("hour")}:${part("minute")}:${part("second")} ${part("timeZoneName")}`;
}

/** §7.1: ✅ on time · 🟠 late · ❌ not filled */
function PhaseCell({ value, windowEnabled }: { value: { at: number | null; isLate: boolean } | null; windowEnabled: boolean }) {
  if (!value) {
    return <span style={{ color: "var(--muted)" }}>Belum diisi</span>;
  }
  return (
    <span style={{ color: windowEnabled && value.isLate ? "#ea580c" : "#16a34a" }}>
      {!windowEnabled ? "Terisi" : value.isLate ? "terlambat" : "tepat waktu"}
    </span>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; status?: string; projectId?: string; divisionId?: string }>;
}) {
  const session = await requireUser();
  // §12: /reports is manager, corporate, admin.
  if (!isAdmin(session.user) && !isManager(session.user) && !isCorporate(session.user)) {
    return (
      <AppShell>
        <h1 className="mb-4 text-xl font-semibold">Report</h1>
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Halaman report hanya untuk Manager, Corporate, dan Admin.
        </p>
      </AppShell>
    );
  }

  const params = await searchParams;
  /*
   * Default the date filter to "today" in the default project timezone, the
   * same clock the project wizard uses for its date defaults. Using UTC here
   * showed an empty list between 17:00–24:00 UTC for teams working on WIB.
   */
  const settings = await getGlobalSettings(getDb());
  const today = toLocalDate(Date.now(), settings.defaultTimezone);
  const from = params.from ?? today;
  const to = params.to ?? today;
  const status = STATUS_FILTERS.some((f) => f.key === params.status)
    ? (params.status as "incomplete" | "critical" | "unreviewed")
    : undefined;

  const db = getDb();
  const ids = await visibleProjectIds(db, session.user);
  const rows = await getDailySummary(db, ids, {
    from,
    to,
    status,
    projectId: params.projectId || undefined,
    divisionId: params.divisionId || undefined,
  });

  const [divisionRows, projectRows] = await Promise.all([
    db.select({ id: divisions.id, name: divisions.name }).from(divisions).orderBy(asc(divisions.name)),
    db
      .select({ id: projects.id, name: projects.name, timezone: projects.timezone })
      .from(projects)
      .where(inArray(projects.id, ids))
      .orderBy(asc(projects.name)),
  ]);

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { from, to, status, projectId: params.projectId, divisionId: params.divisionId, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v && v !== "all") p.set(k, v);
    const s = p.toString();
    return s ? `/reports?${s}` : "/reports";
  };

  return (
    <AppShell>
      <PageHeader eyebrow="REPORTS & INSIGHTS" title="Report Harian" description="Tinjau kelengkapan laporan dan progres setiap project, setiap hari." action={<Link href="/dashboard" className="btn-secondary">Dashboard<Icon name="arrow" size={16} /></Link>} />
      <div className="mb-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard label="Laporan harian" value={rows.length} icon="layers" hint="Sesuai periode dan filter" />
        <MetricCard label="Opening & closing terisi" value={rows.filter(r => r.opening && r.closing).length} icon="check" tone="success" hint="Kedua laporan tersedia" />
        <MetricCard label="Belum direview" value={rows.filter(r => !r.reviewedAt).length} icon="clock" tone="neutral" hint="Menunggu pemeriksaan" />
        <MetricCard label="Perlu perhatian" value={rows.filter(r => r.hasCriticalOpen).length} icon="alert" tone="warning" hint="Memiliki issue High / Critical" />
      </div>

      {/* §7.1 filters */}
      <form
        action="/reports"
        method="get"
        className="surface-card mb-4 flex flex-col gap-3 p-4 lg:flex-row lg:flex-wrap lg:items-end"
      >
        <div className="grid grid-cols-2 gap-2 lg:contents">
          <label className="flex flex-col gap-1 text-xs lg:w-44" style={{ color: "var(--muted)" }}>
            Dari
            <input
              type="date"
              name="from"
              defaultValue={from}
              className="min-h-[40px] rounded-lg border px-2 text-sm"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs lg:w-44" style={{ color: "var(--muted)" }}>
            Sampai
            <input
              type="date"
              name="to"
              defaultValue={to}
              className="min-h-[40px] rounded-lg border px-2 text-sm"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:contents">
          <label className="flex flex-col gap-1 text-xs lg:w-44" style={{ color: "var(--muted)" }}>
            Divisi
            <select
              name="divisionId"
              defaultValue={params.divisionId ?? ""}
              className="min-h-[40px] rounded-lg border px-2 text-sm"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
            >
              <option value="">Semua</option>
              {divisionRows.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs lg:w-44" style={{ color: "var(--muted)" }}>
            Project
            <select
              name="projectId"
              defaultValue={params.projectId ?? ""}
              className="min-h-[40px] rounded-lg border px-2 text-sm"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
            >
              <option value="">Semua</option>
              {projectRows.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <input type="hidden" name="status" value={params.status ?? "all"} />
        <button
          type="submit"
          className="btn-primary"
        >
          Terapkan filter
        </button>
      </form>

      <div className="mb-3 flex flex-wrap gap-1">
        {STATUS_FILTERS.map((f) => {
          const active = (params.status ?? "all") === f.key;
          return (
            <Link
              key={f.key}
              href={qs({ status: f.key })}
              aria-pressed={active}
              className="min-h-[32px] rounded-full border px-3 text-xs leading-[30px]"
              style={{
                borderColor: "var(--border)",
                background: active ? "var(--accent-solid)" : "var(--surface)",
                color: active ? "#fff" : "var(--muted)",
              }}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Tidak ada data untuk filter ini.
        </p>
      ) : (
        <>
        <ul className="flex flex-col gap-2 lg:hidden">
          {rows.map((r) => {
            const project = projectRows.find((p) => p.id === r.projectId);
            const tone = r.hasCriticalOpen ? "#dc2626" : r.reviewedAt ? "#16a34a" : "var(--border)";
            return (
              <li key={`${r.projectId}-${r.date}`}>
                <div
                  className="block rounded-xl border px-4 py-3"
                  style={{
                    borderColor: tone,
                    borderWidth: r.hasCriticalOpen ? 2 : 1,
                    background: "var(--surface)",
                    color: "var(--fg)",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={r.projectDayId ? `/reports/day/${r.projectDayId}` : "/reports"} className="font-medium" style={{ color: "var(--fg)" }}>{r.projectName}</Link>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        {r.date} · {r.divisionName}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                      {r.reviewedAt ? "reviewed" : "belum review"}
                    </span>
                  </div>

                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                    <div className="flex justify-between gap-1">
                      <dt style={{ color: "var(--muted)" }}>Opening</dt>
                      <dd>
                        <PhaseCell value={r.opening} windowEnabled={settings.openingWindowEnabled} />
                        {r.opening?.at ? ` ${timeInZone(r.opening.at, project?.timezone ?? "Asia/Jakarta")}` : ""}
                        {r.opening?.by ? <span className="block" style={{ color: "var(--muted)" }}>Diisi oleh {r.opening.by}</span> : null}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-1">
                      <dt style={{ color: "var(--muted)" }}>Closing</dt>
                      <dd>
                        <PhaseCell value={r.closing} windowEnabled={settings.closingWindowEnabled} />
                        {r.closing?.at ? ` ${timeInZone(r.closing.at, project?.timezone ?? "Asia/Jakarta")}` : ""}
                        {r.closing?.by ? <span className="block" style={{ color: "var(--muted)" }}>Diisi oleh {r.closing.by}</span> : null}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-1">
                      <dt style={{ color: "var(--muted)" }}>Monitoring</dt>
                      <dd>{r.monitoringCount}</dd>
                    </div>
                    <div className="flex justify-between gap-1">
                      <dt style={{ color: "var(--muted)" }}>Checklist OK</dt>
                      <dd>{r.checklistOkPct === null ? "—" : `${r.checklistOkPct}%`}</dd>
                    </div>
                    <div className="flex justify-between gap-1">
                      <dt style={{ color: "var(--muted)" }}>Issue (baru/terbuka)</dt>
                      <dd style={{ color: r.hasCriticalOpen ? "#dc2626" : undefined }}>
                        {r.issuesNew} / <Link href={`/issues?projectId=${r.projectId}&open=1`} className="underline underline-offset-2">{r.issuesOpen} ↗</Link>
                      </dd>
                    </div>
                    <div className="flex justify-between gap-1">
                      <dt style={{ color: "var(--muted)" }}>Foto</dt>
                      <dd>{r.photoCount}</dd>
                    </div>
                  </dl>
                  <Link href={r.projectDayId ? `/reports/day/${r.projectDayId}` : "/reports"} className="mt-2 flex min-h-tap items-center text-xs" style={{ color: "var(--accent)" }}>Lihat laporan & checklist →</Link>
                </div>
              </li>
            );
          })}
        </ul>

        {/* Desktop: one row per project-day, so many days can be compared at a
            glance without scrolling a stack of cards. */}
        <div
          role="region"
          aria-label="Report harian per project"
          tabIndex={0}
          className="hidden overflow-x-auto rounded-xl border lg:block"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <table className="w-full min-w-[1024px] border-collapse text-sm">
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                {[
                  "Project",
                  "Tanggal",
                  "Divisi",
                  "Opening",
                  "Closing",
                  "Monitoring",
                  "Checklist OK",
                  "Issue (baru/terbuka)",
                  "Foto",
                  "Review",
                ].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`px-3 py-2 text-left text-xs font-medium ${i >= 3 && i <= 8 ? "text-right" : ""}`}
                    style={{ color: "var(--muted)" }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const project = projectRows.find((p) => p.id === r.projectId);
                const tone = r.hasCriticalOpen ? "#dc2626" : r.reviewedAt ? "#16a34a" : "var(--border)";
                return (
                  <tr
                    key={`${r.projectId}-${r.date}`}
                    style={{ borderTop: `1px solid var(--border)`, borderLeft: `3px solid ${tone}` }}
                  >
                    <td className="px-3 py-1.5">
                      <Link href={r.projectDayId ? `/reports/day/${r.projectDayId}` : "/reports"} className="font-medium" style={{ color: "var(--fg)" }}>
                        {r.projectName}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs" style={{ color: "var(--muted)" }}>
                      {r.date}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs" style={{ color: "var(--muted)" }}>
                      {r.divisionName}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs">
                      <PhaseCell value={r.opening} windowEnabled={settings.openingWindowEnabled} />
                      {r.opening?.at ? (
                        <span style={{ color: "var(--muted)" }}>
                          {" "}
                          {timeInZone(r.opening.at, project?.timezone ?? "Asia/Jakarta")}
                        </span>
                      ) : null}
                      {r.opening?.by ? <span className="block" style={{ color: "var(--muted)" }}>Diisi oleh {r.opening.by}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-xs">
                      <PhaseCell value={r.closing} windowEnabled={settings.closingWindowEnabled} />
                      {r.closing?.at ? (
                        <span style={{ color: "var(--muted)" }}>
                          {" "}
                          {timeInZone(r.closing.at, project?.timezone ?? "Asia/Jakarta")}
                        </span>
                      ) : null}
                      {r.closing?.by ? <span className="block" style={{ color: "var(--muted)" }}>Diisi oleh {r.closing.by}</span> : null}
                    </td>
                    <td className="px-3 py-1.5 text-right">{r.monitoringCount}</td>
                    <td className="px-3 py-1.5 text-right">
                      {r.checklistOkPct === null ? "—" : `${r.checklistOkPct}%`}
                    </td>
                    <td className="px-3 py-1.5 text-right" style={{ color: r.hasCriticalOpen ? "#dc2626" : undefined }}>
                      {r.issuesNew} / <Link href={`/issues?projectId=${r.projectId}&open=1`} className="underline underline-offset-2" aria-label={`Lihat ${r.issuesOpen} issue belum ditutup ${r.projectName}`}>{r.issuesOpen}{r.hasCriticalOpen ? " ⚠" : ""} ↗</Link>
                    </td>
                    <td className="px-3 py-1.5 text-right">{r.photoCount}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs" style={{ color: r.reviewedAt ? "#16a34a" : "var(--muted)" }}>
                      {r.reviewedAt ? "✓ reviewed" : "belum review"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </AppShell>
  );
}
