import Link from "next/link";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { issueCategories, projects } from "@/server/db/schema";
import { LiveSearchFilters } from "@/components/LiveSearchFilters";
import { normalizeSearch } from "@/server/search";
import { listIssues, type IssueStatus, type Severity } from "@/server/services/issues";
import { visibleProjectIds } from "@/server/visibility";
import { ISSUE_STATUSES, SEVERITIES, severityLabel, issueStatusLabel } from "@/lib/schemas";
import { Pill, SEVERITY_TONE, STATUS_TONE } from "@/components/issues/IssueBadges";
import { Icon, PageHeader } from "@/components/ui/WorkspaceUI";

export const metadata = { title: "Issues — Ops" };

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; severity?: string; projectId?: string; open?: string; active?: string; q?: string }>;
}) {
  const session = await requireUser();
  const { status, severity, projectId, open, active, q } = await searchParams;
  const query = normalizeSearch(q);
  const activeOnly = open === "1";
  const activeProjectsOnly = active === "1";
  const db = getDb();

  const ids = await visibleProjectIds(db, session.user);
  const validStatus = !activeOnly && ISSUE_STATUSES.includes(status as IssueStatus) ? (status as IssueStatus) : undefined;
  const validSeverity = SEVERITIES.includes(severity as Severity) ? (severity as Severity) : undefined;

  const rows = await listIssues(db, session.user, ids, {
    status: validStatus,
    severity: validSeverity,
    projectId: projectId || undefined,
    excludeClosed: activeOnly,
    activeProjectsOnly,
    query,
  });
  const projectOptions = ids.length ? await db.select({ id: projects.id, code: projects.code, name: projects.name }).from(projects)
    .where(and(inArray(projects.id, ids), isNull(projects.deletedAt), activeProjectsOnly ? eq(projects.status, "active") : undefined)).orderBy(asc(projects.name)) : [];

  const categories = await db
    .select({ id: issueCategories.id, name: issueCategories.name })
    .from(issueCategories)
    .where(eq(issueCategories.isActive, true))
    .orderBy(asc(issueCategories.sortOrder));

  const canCreate = ids.length > 0 && categories.length > 0;

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { status: validStatus, severity: validSeverity, projectId, q: query, active: activeProjectsOnly ? "1" : undefined, open: "status" in patch ? undefined : activeOnly ? "1" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/issues?${s}` : "/issues";
  };

  return (
    <AppShell>
      <PageHeader eyebrow="FOLLOW UP & RESOLUTION" title="Issues" description="Catat kendala, tentukan prioritas, dan ikuti tindak lanjutnya." action={canCreate ? <Link href="/issues/new" className="btn-primary"><Icon name="plus" size={17} />Issue baru</Link> : undefined} />

      {/* Filters (§12 /issues) */}
      <LiveSearchFilters placeholder="Cari issue atau project" projects={projectOptions} />
      {activeProjectsOnly ? <p className="mb-2 text-xs" style={{ color: "var(--muted)" }}>Project aktif · <Link href={qs({ active: undefined })} className="underline">Lihat semua project</Link></p> : null}
      <div className="mb-3 flex flex-wrap gap-2">
        <Link
          href={qs({ status: undefined })}
          className="min-h-[32px] rounded-full border px-3 text-xs leading-[30px]"
          style={{
            borderColor: "var(--border)",
            background: !validStatus && !activeOnly ? "var(--accent-solid)" : "var(--surface)",
            color: !validStatus && !activeOnly ? "#fff" : "var(--muted)",
          }}
        >
          Semua
        </Link>
        <Link href={qs({ status: undefined, open: "1" })} className="min-h-[32px] rounded-full border px-3 text-xs leading-[30px]" style={{ borderColor: "var(--border)", background: activeOnly ? "var(--accent-solid)" : "var(--surface)", color: activeOnly ? "#fff" : "var(--muted)" }}>Belum ditutup</Link>
        {ISSUE_STATUSES.map((s) => (
          <Link
            key={s}
            href={qs({ status: s })}
            className="min-h-[32px] rounded-full border px-3 text-xs leading-[30px]"
            style={{
              borderColor: "var(--border)",
              background: validStatus === s ? "var(--accent-solid)" : "var(--surface)",
              color: validStatus === s ? "#fff" : "var(--muted)",
            }}
          >
            {issueStatusLabel[s]}
          </Link>
        ))}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[10px] font-medium text-[var(--muted)]">Prioritas</span>
        {SEVERITIES.map((s) => (
          <Link
            key={s}
            href={qs({ severity: validSeverity === s ? undefined : s })}
            className="min-h-[32px] rounded-full border px-3 text-xs leading-[30px]"
            style={{
              borderColor: "var(--border)",
              background: validSeverity === s ? "var(--accent-solid)" : "var(--surface)",
              color: validSeverity === s ? "#fff" : "var(--muted)",
            }}
          >
            {severityLabel[s]}
          </Link>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between"><h2 className="section-title">Daftar issues<span className="ml-2 rounded-md bg-[var(--border)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">{rows.length}</span></h2><span className="text-[10px] text-[var(--muted)]">{rows.filter(i => i.status !== "closed").length} belum ditutup</span></div>
      {rows.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Tidak ada issue untuk filter ini.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((i) => (
            <li key={i.id}>
              <Link
                href={`/issues/${i.id}`}
                className="project-card"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {i.code}
                      {i.categoryName ? ` · ${i.categoryName}` : ""}
                    </p>
                    <h3 className="mb-2 mt-2 text-base font-semibold leading-6 tracking-tight">{i.title}</h3>
                    <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                      {i.projectName}
                      {i.dayDate ? ` · ${i.dayDate}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Pill label={severityLabel[i.severity]} tone={SEVERITY_TONE[i.severity]} />
                    <Pill label={issueStatusLabel[i.status]} tone={STATUS_TONE[i.status]} />
                  </div>
                </div>

                <p className="mt-5 border-t border-[var(--border)] pt-4 text-[10px] leading-5" style={{ color: "var(--muted)" }}>
                  Diposting oleh {i.authorName} · {i.authorRole}
                  {i.authorDivision ? ` · ${i.authorDivision}` : ""} ·{" "}
                  {new Date(i.createdAt).toLocaleString("id-ID")}
                </p>

                <p className="mt-2 text-[11px]" style={{ color: "var(--muted)" }}>
                  {i.photoCount} foto · {i.commentCount} komentar
                  {i.picName || i.picExternal ? ` · PIC: ${i.picName ?? i.picExternal}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
