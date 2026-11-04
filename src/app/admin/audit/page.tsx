import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { auditFacets, listAuditLogs } from "@/server/services/audit";
import { isAdmin } from "@/server/permissions";

export const metadata = { title: "Admin — Audit" };

const dateToMs = (d: string | undefined, endOfDay: boolean): number | undefined => {
  if (!d) return undefined;
  const ms = Date.parse(`${d}T00:00:00.000Z`);
  if (!Number.isFinite(ms)) return undefined;
  return endOfDay ? ms + 86_400_000 - 1 : ms;
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ userId?: string; entityType?: string; action?: string; from?: string; to?: string }>;
}) {
  const session = await requireUser();

  if (!isAdmin(session.user)) {
    return (
      <AppShell>
        <h1 className="mb-4 text-xl font-semibold">Audit Log</h1>
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Halaman ini hanya untuk Admin.
        </p>
      </AppShell>
    );
  }

  const sp = await searchParams;
  const db = getDb();

  const [rows, facets] = await Promise.all([
    listAuditLogs(db, session.user, {
      userId: sp.userId || undefined,
      entityType: sp.entityType || undefined,
      action: sp.action || undefined,
      from: dateToMs(sp.from, false),
      to: dateToMs(sp.to, true),
      limit: 300,
    }),
    auditFacets(db, session.user),
  ]);

  const inputStyle = {
    background: "var(--surface)",
    borderColor: "var(--border)",
    color: "var(--fg)",
  } as const;

  return (
    <AppShell>
      <AdminNav active="audit" />
      <h1 className="mb-4 text-xl font-semibold">Audit Log</h1>

      <form action="/admin/audit" method="get" className="mb-3 flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Dari
            <input type="date" name="from" defaultValue={sp.from ?? ""} className="min-h-[40px] rounded-lg border px-2 text-sm" style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Sampai
            <input type="date" name="to" defaultValue={sp.to ?? ""} className="min-h-[40px] rounded-lg border px-2 text-sm" style={inputStyle} />
          </label>
        </div>

        <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
          User
          <select name="userId" defaultValue={sp.userId ?? ""} className="min-h-[40px] rounded-lg border px-2 text-sm" style={inputStyle}>
            <option value="">Semua</option>
            {facets.actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Entitas
            <select name="entityType" defaultValue={sp.entityType ?? ""} className="min-h-[40px] rounded-lg border px-2 text-sm" style={inputStyle}>
              <option value="">Semua</option>
              {facets.entityTypes.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.value} ({e.count})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Aksi
            <select name="action" defaultValue={sp.action ?? ""} className="min-h-[40px] rounded-lg border px-2 text-sm" style={inputStyle}>
              <option value="">Semua</option>
              {facets.actions.map((a) => (
                <option key={a.value} value={a.value}>
                  {a.value} ({a.count})
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="submit"
          className="min-h-tap rounded-lg px-4 py-2 text-sm font-medium text-white"
          style={{ background: "var(--accent-solid)" }}
        >
          Terapkan filter
        </button>
      </form>

      <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>
        {rows.length} entri
      </p>

      {rows.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Tidak ada entri untuk filter ini.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <p style={{ color: "var(--muted)" }}>
                {new Date(r.createdAt).toLocaleString("id-ID")} · {r.userName ?? "sistem"}
                {r.ip ? ` · ${r.ip}` : ""}
              </p>
              <p className="font-medium">{r.action}</p>
              <p style={{ color: "var(--muted)" }}>
                {r.entityType} · {r.entityId.slice(0, 12)}
              </p>
              {r.metaJson ? (
                <p className="mt-0.5 break-all" style={{ color: "var(--muted)" }}>
                  {r.metaJson.slice(0, 200)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs" style={{ color: "var(--muted)" }}>
        <Link href="/admin/users" style={{ color: "var(--accent)" }}>
          ← Kembali ke User
        </Link>
      </p>
    </AppShell>
  );
}
