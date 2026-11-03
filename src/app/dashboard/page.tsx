import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getDashboard } from "@/server/services/reports-review";
import { visibleProjectIds } from "@/server/visibility";
import { isAdmin, isCorporate, isManager } from "@/server/permissions";
import { issueStatusLabel } from "@/lib/schemas";

export const metadata = { title: "Dashboard — Ops" };

export default async function DashboardPage() {
  const session = await requireUser();

  if (!isAdmin(session.user) && !isManager(session.user) && !isCorporate(session.user)) {
    return (
      <AppShell>
        <h1 className="mb-4 text-xl font-semibold">Dashboard</h1>
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Dashboard hanya untuk Manager, Corporate, dan Admin.
        </p>
      </AppShell>
    );
  }

  const db = getDb();
  const ids = await visibleProjectIds(db, session.user);
  const data = await getDashboard(db, ids);

  const stat = (label: string, value: string | number, tone?: string) => (
    <div
      className="rounded-xl border px-3 py-2 text-center"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {label}
      </p>
      <p className="text-lg font-semibold" style={{ color: tone }}>
        {value}
      </p>
    </div>
  );

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <Link href="/reports" className="text-xs" style={{ color: "var(--accent)" }}>
          Report →
        </Link>
      </div>

      <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>
        Hari ini · {data.today}
      </p>

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-3 lg:gap-3 xl:grid-cols-6">
        {stat("Project aktif", data.activeProjects)}
        {stat("Opening terisi", `${data.openingDone}/${data.activeProjects}`)}
        {stat("Closing terisi", `${data.closingDone}/${data.activeProjects}`)}
        {stat("Monitoring", data.monitoringTotal)}
        <Link href="/issues?open=1&active=1">{stat("Issue terbuka", Object.values(data.openIssuesBySeverity).reduce((a, b) => a + b, 0), "#991b1b")}</Link>
        {stat("Hari belum direview", data.unreviewedDays, data.unreviewedDays > 0 ? "#ea580c" : undefined)}
      </div>

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
          Issue terbuka per severity
        </h2>
        <ul className="flex gap-1 lg:grid lg:grid-cols-4 lg:gap-3">
          {(["critical", "high", "medium", "low"] as const).map((s) => (
            <li
              key={s}
              className="flex-1 rounded-lg border text-center text-xs"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <Link href={`/issues?severity=${s}&open=1&active=1`} className="block min-h-tap rounded-lg px-2 py-2" style={{ color: "var(--fg)" }} aria-label={`Lihat ${data.openIssuesBySeverity[s]} issue ${s} belum ditutup`}>
              <p style={{ color: "var(--muted)" }}>{s}</p>
              <p className="font-semibold">{data.openIssuesBySeverity[s]}</p>
              <span className="text-[11px]" style={{ color: "var(--accent)" }}>Lihat issue →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
          Butuh perhatian ({data.needsAttention.length})
        </h2>
        {data.needsAttention.length === 0 ? (
          <p
            className="rounded-xl border px-4 py-6 text-center text-sm"
            style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
          >
            Tidak ada yang perlu perhatian khusus.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 lg:grid lg:grid-cols-2 lg:gap-2 xl:grid-cols-3">
            {data.needsAttention.map((n, i) => (
              <li key={`${n.kind}-${n.projectId}-${i}`}>
                <Link
                  href={n.issueId ? `/issues/${n.issueId}` : `/projects/${n.projectId}?tab=today`}
                  className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "#fca5a5", background: "var(--surface)", color: "var(--fg)" }}
                >
                  <span aria-hidden="true" style={{ color: "#dc2626" }}>
                    ●
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium">{n.projectName}</span>
                    <span className="block text-xs" style={{ color: "var(--muted)" }}>
                      {n.detail}
                    </span>
                    {n.issueStatus ? <span className="mt-1 block text-xs" style={{ color: "var(--accent)" }}>{issueStatusLabel[n.issueStatus as keyof typeof issueStatusLabel]} · Buka tindak lanjut →</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}
