import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MasterNav, EmptyState } from "@/components/master/MasterNav";
import { requireUserWithoutPasswordChange } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { listDivisionTemplates, listUnassignedLegacyTemplates } from "@/server/services/division-templates";
import { canCreateProject, isAdmin } from "@/server/permissions";

export const metadata = { title: "Template Divisi — Pulse" };

export default async function TemplatesPage({ searchParams }: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  const { user } = await requireUserWithoutPasswordChange();
  if (!canCreateProject(user)) redirect("/");
  const { deleted } = await searchParams;
  const db = getDb();
  const templates = listDivisionTemplates(db, user);
  const legacyCount = isAdmin(user) ? listUnassignedLegacyTemplates(db, user).length : 0;
  const grouped = new Map<string, typeof templates>();
  for (const template of templates) {
    const division = grouped.get(template.divisionName) ?? [];
    division.push(template);
    grouped.set(template.divisionName, division);
  }
  const rows = (list: typeof templates) => list.map((template) => (
    <Link href={`/master/templates/${encodeURIComponent(template.id)}`} key={template.id}
      className="flex min-h-14 items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 transition-colors hover:bg-[var(--bg)] sm:px-5">
      <span className="min-w-0 break-words font-medium">{template.name}</span>
      <span className="shrink-0 text-sm text-[var(--muted)]">{template.itemCount} poin <span aria-hidden="true" className="ml-2">›</span></span>
    </Link>
  ));

  return (
    <AppShell>
      {isAdmin(user) ? <MasterNav active="templates" isAdmin /> : null}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Template Divisi</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Simpan checklist yang bisa dipakai ulang untuk project di divisi yang sama.</p>
        </div>
        <Link className="btn-primary" href="/master/templates/new">Upload Excel</Link>
      </header>
      {isAdmin(user) && deleted === "1" ? <p role="status" className="status-badge tone-ok mb-4">Template berhasil dihapus permanen.</p> : null}
      {!grouped.size ? <EmptyState>Belum ada template. Upload Excel untuk membuat template pertama.</EmptyState> : null}
      <div className="grid gap-4">
        {[...grouped].map(([division, list]) => {
          const active = list.filter((template) => template.isActive);
          const archived = list.filter((template) => !template.isActive);
          return (
            <section key={division} className="surface-card overflow-hidden">
              <h2 className="section-title px-4 py-3.5 sm:px-5">{division}</h2>
              {active.length ? rows(active) : <p className="border-t border-[var(--border)] px-4 py-3 text-sm text-[var(--muted)]">Belum ada template aktif.</p>}
              {archived.length ? (
                <details className="border-t border-[var(--border)]">
                  <summary className="cursor-pointer px-4 py-3 text-sm text-[var(--muted)] sm:px-5">Arsip ({archived.length})</summary>
                  {rows(archived)}
                </details>
              ) : null}
            </section>
          );
        })}
      </div>
      {legacyCount ? <Link href="/master/templates/legacy" className="btn-secondary mt-4">Template lama tanpa divisi ({legacyCount})</Link> : null}
    </AppShell>
  );
}
