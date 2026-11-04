import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { visibleProjectIds } from "@/server/visibility";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { LiveSearchFilters } from "@/components/LiveSearchFilters";
import { normalizeSearch, textSearch } from "@/server/search";
import { Icon, MetricCard, PageHeader } from "@/components/ui/WorkspaceUI";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Aktif",
  completed: "Selesai",
  archived: "Arsip",
};

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = normalizeSearch((await searchParams).q);
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
          .where(and(inArray(projects.id, ids), isNull(projects.deletedAt), textSearch(query, projects.name, projects.code, projects.venue, projects.client)));

  const canCreate =
    session.user.isActive && (session.user.role === "admin" || session.user.role === "manager");

  return (
    <AppShell>
      <PageHeader eyebrow="PROJECT WORKSPACE" title="Project" description="Semua project, tim, dan progres operasional dalam satu tempat." action={canCreate ? <Link href="/projects/new" className="btn-primary"><Icon name="plus" size={17} />Project baru</Link> : undefined} />
      <div className="project-metrics mb-7 grid grid-cols-3 gap-2 sm:gap-4">
        <MetricCard label={query ? "Hasil pencarian" : "Total project"} value={rows.length} icon="folder" hint="Dalam akses Anda" />
        <MetricCard label="Aktif" value={rows.filter(p => p.status === "active").length} icon="layers" tone="success" hint={query ? "Pada hasil pencarian" : "Operasional berjalan"} />
        <MetricCard label="Selesai" value={rows.filter(p => p.status === "completed").length} icon="check" tone="neutral" hint={query ? "Pada hasil pencarian" : "Telah diselesaikan"} />
      </div>

      <LiveSearchFilters placeholder="Cari project, kode, venue, atau client" />
      <div className="mb-4 flex items-center justify-between gap-3"><h2 className="section-title">{query ? "Hasil pencarian" : "Daftar project"}<span className="ml-2 rounded-md bg-[var(--border)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">{rows.length}</span></h2><span className="hidden text-xs text-[var(--muted)] sm:block">Pilih project untuk melihat detail</span></div>
      {rows.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          {query ? "Project tidak ditemukan untuk pencarian ini." : "Belum ada project."}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <li key={p.id} className="h-full">
              <Link
                href={`/projects/${p.id}`}
                className="project-card group"
              >
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"><Icon name="folder" /></span>
                <span
                  className={`status-badge ${p.status === "active" ? "tone-success" : p.status === "completed" ? "tone-accent" : "tone-neutral"}`}
                >
                  <span className="status-dot" />{STATUS_LABEL[p.status] ?? p.status}
                </span>
              </div>
              <p className="mt-5 text-[10px] font-medium tracking-wide text-[var(--muted)]">{p.code}</p>
              <h3 className="mt-1 text-[17px] font-semibold leading-6 tracking-tight">{p.name}</h3>
              {p.client ? <p className="mt-1 text-xs text-[var(--muted)]">{p.client}</p> : null}
              <p className="mt-4 flex items-center gap-2 text-xs text-[var(--muted)]"><Icon name="pin" size={14} />{p.venue}</p>
              <div className="project-card-footer"><span className="flex items-center gap-1.5 text-[10px]"><Icon name="calendar" size={14} />{new Intl.DateTimeFormat("id-ID", {day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(p.startDate))} – {new Intl.DateTimeFormat("id-ID", {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(p.endDate))}</span><span className="flex items-center gap-1 text-[11px] font-medium text-[var(--accent)]">Detail<Icon name="arrow" size={14} /></span></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
