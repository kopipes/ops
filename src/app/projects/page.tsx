import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { visibleProjectIds } from "@/server/visibility";
import { and, eq, inArray, isNull } from "drizzle-orm";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Aktif",
  completed: "Selesai",
  archived: "Arsip",
};

export default async function ProjectsPage() {
  const session = await requireUser();
  const db = getDb();

  const ids = await visibleProjectIds(db, session.user, { includeArchived: true });
  const rows =
    ids.length === 0
      ? []
      : await db
          .select({
            id: projects.id,
            code: projects.code,
            name: projects.name,
            client: projects.client,
            venue: projects.venue,
            status: projects.status,
            startDate: projects.startDate,
            endDate: projects.endDate,
          })
          .from(projects)
          .where(and(inArray(projects.id, ids), isNull(projects.deletedAt)));

  const canCreate =
    session.user.isActive && (session.user.role === "admin" || session.user.role === "manager");

  return (
    <AppShell>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Project</h1>
        {canCreate ? (
          <a
            href="/projects/new"
            className="min-h-[40px] rounded-lg px-3 text-sm font-medium leading-[40px] text-white"
            style={{ background: "var(--accent)" }}
          >
            + Project
          </a>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Belum ada project.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((p) => (
            <li key={p.id}>
              <a
                href={`/projects/${p.id}`}
                className="block rounded-xl border px-4 py-3"
                style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--fg)" }}
              >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {p.code} · {p.venue}
                    {p.client ? ` · ${p.client}` : ""}
                  </p>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                  style={{ background: "var(--border)", color: "var(--fg)" }}
                >
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
              </div>
              <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {p.startDate} → {p.endDate}
              </p>
              </a>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
