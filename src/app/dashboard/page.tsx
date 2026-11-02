import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getDashboard } from "@/server/services/reports-review";
import { visibleProjectIds } from "@/server/visibility";
import { isAdmin, isCorporate, isManager } from "@/server/permissions";

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

      <div className="mb-4 grid grid-cols-2 gap-2">
        {stat("Project aktif", data.activeProjects)}
        {stat("Opening terisi", `${data.openingDone}/${data.activeProjects}`)}
        {stat("Closing terisi", `${data.closingDone}/${data.activeProjects}`)}
        {stat("Monitoring", data.monitoringTotal)}
        {stat("Issue terbuka", Object.values(data.openIssuesBySeverity).reduce((a, b) => a + b, 0), "#991b1b")}
        {stat("Hari belum direview", data.unreviewedDays, data.unreviewedDays > 0 ? "#ea580c" : undefined)}
      </div>

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
          Issue terbuka per severity
        </h2>
        <ul className="flex gap-1">
          {(["critical", "high", "medium", "low"] as const).map((s) => (
            <li
              key={s}
              className="flex-1 rounded-lg border px-2 py-1 text-center text-xs"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <p style={{ color: "var(--muted)" }}>{s}</p>
              <p className="font-semibold">{data.openIssuesBySeverity[s]}</p>
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
          <ul className="flex flex-col gap-1">
            {data.needsAttention.map((n, i) => (
              <li key={`${n.kind}-${n.projectId}-${i}`}>
                <Link
                  href={`/projects/${n.projectId}?tab=today`}
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
