import { notFound, redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ProjectDetailsForm } from "@/components/project/ProjectDetailsForm";
import { ProjectChecklistEditor } from "@/components/project/ProjectChecklistEditor";
import { DeleteProjectButton } from "@/components/project/DeleteProjectButton";
import { ExportPdfForm } from "@/components/pdf/ExportPdfForm";
import { exportProjectPdfAction } from "@/app/pdf-actions";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import {
  divisions,
  issues,
  projectDays,
  projects,
  reports,
  users,
} from "@/server/db/schema";
import { loadFacts, listActiveProjectDays } from "@/server/services/projects";
import { listProjectChecklist } from "@/server/services/project-checklist";
import { listMembers, listMemberCandidates } from "@/server/services/members";
import { canDeleteProject, canExportPdf, canManageProject, canSubmitPhase, canViewProject, isReportOnlyProjectMember } from "@/server/permissions";
import { formatReportTimestamp, toLocalDate } from "@/lib/datetime";
import { PROJECT_ROLES, projectRoleLabel, projectRoleOptionLabel } from "@/lib/project-roles";
import { PHASES, phaseLabel } from "@/lib/schemas";
import { checklistEditVersion, listProjectChecklistHistory } from "@/server/services/project-checklist-editor";
import { getGlobalSettings, isWindowEnabled } from "@/server/services/app-settings";
import {
  addMemberAction,
  removeMemberAction,
  setProjectStatusAction,
  setMemberRoleAction,
  assignOfficerAction,
  setDayTypeAction,
} from "@/app/project-actions";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const p = await db.select({ name: projects.name }).from(projects).where(and(eq(projects.id, id), isNull(projects.deletedAt))).get();
  return { title: p ? `${p.name} — Pulse` : "Project — Pulse" };
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  active: "Aktif",
  completed: "Selesai",
  archived: "Arsip",
};

const TABS = ["today", "days", "checklist", "members", "settings"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABEL: Record<Tab, string> = {
  today: "Hari ini",
  days: "Hari",
  checklist: "Checklist",
  members: "Member",
  settings: "Settings",
};

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; edit?: string; saved?: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;
  const { tab: tabParam, edit, saved } = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? "")
    ? (tabParam as Tab)
    : "today";

  const db = getDb();
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project || project.deletedAt) notFound();

  const facts = await loadFacts(db, id);
  // §2.2: visibility is enforced server-side, not by hiding the link.
  if (!canViewProject(session.user, facts)) redirect("/projects");

  const canManage = canManageProject(session.user, facts);
  const canExport = canExportPdf(session.user, facts);
  if (isReportOnlyProjectMember(session.user, facts)) {
    const reportFilters = new URLSearchParams({ projectId: id, from: project.startDate, to: project.endDate });
    return (
      <AppShell contentWidth="form">
        <h1>{project.name}</h1>
        <p className="mb-4 text-sm text-[var(--muted)]">{project.code ? `${project.code} · ` : ""}Admin Project (akses laporan)</p>
        <Link className="btn-primary mb-4" href={`/reports?${reportFilters}`}>Lihat laporan harian</Link>
        <section className="surface-card p-4">
          <h2 className="section-title mb-3">Rekap project</h2>
          <ExportPdfForm
            action={exportProjectPdfAction}
            hidden={{ projectId: id }}
            submitLabel="Export PDF rekap project"
            showDateRange
            defaultFrom={project.startDate}
            defaultTo={project.endDate}
            hint="Maksimal 31 hari per PDF."
          />
        </section>
      </AppShell>
    );
  }
  const settings = await getGlobalSettings(db);

  const [days, checklist, members, ownerDivision, owner] = await Promise.all([
    listActiveProjectDays(db, id),
    tab === "checklist" ? listProjectChecklist(db, id) : [],
    listMembers(db, id),
    db
      .select({ name: divisions.name })
      .from(divisions)
      .where(eq(divisions.id, project.ownerDivisionId))
      .get(),
    project.createdBy ? db.select({ name: users.name }).from(users).where(eq(users.id, project.createdBy)).get() : undefined,
  ]);

  const editingDetails = tab === "settings" && canManage && edit === "1";
  const divisionOptions = editingDetails ? db.select({ id: divisions.id, name: divisions.name }).from(divisions)
    .where(or(eq(divisions.isActive, true), inArray(divisions.id, [project.ownerDivisionId, ...facts.divisionIds])))
    .orderBy(asc(divisions.name)).all() : [];
  const editingChecklist = tab === "checklist" && canManage && edit === "1";
  const checklistHistory = tab === "checklist" && canManage && !editingChecklist ? listProjectChecklistHistory(db, id) : [];
  const candidates = canManage ? await listMemberCandidates(db, id) : [];
  const today = toLocalDate(Date.now(), project.timezone);
  const todayDay = days.find((d) => d.date === today);

  // Report presence per day, for the "Hari" tab.
  const dayIds = days.map((d) => d.id);
  const dayReports =
    dayIds.length === 0
      ? []
      : await db
          .select({
            projectDayId: reports.projectDayId,
            phase: reports.phase,
            status: reports.status,
            isLate: reports.isLate,
          })
          .from(reports)
          .where(and(inArray(reports.projectDayId, dayIds), isNull(reports.deletedAt)));

  const openIssues =
    (await db
      .select({ id: issues.id, code: issues.code, title: issues.title, severity: issues.severity })
      .from(issues)
      .where(and(eq(issues.projectId, id), isNull(issues.deletedAt)))
      .limit(5)) ?? [];

  return (
    <AppShell>
      <header className="mb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{project.name}</h1>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {project.code ? `${project.code} · ` : ""}{project.venue}
              {project.client ? ` · ${project.client}` : ""}
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              {project.startDate} → {project.endDate} · {ownerDivision?.name}
            </p>
            {owner ? <p className="mt-1 text-sm text-[var(--muted)]"><span className="font-semibold">Owner:</span> {owner.name}</p> : null}
          </div>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
            style={{ background: "var(--border)" }}
          >
            {STATUS_LABEL[project.status]}
          </span>
        </div>
        {canDeleteProject(session.user) ? <div className="mt-3 flex justify-end"><DeleteProjectButton projectId={id} projectName={project.name} projectCode={project.code} /></div> : null}
      </header>

      <nav
        aria-label="Tab project"
        className="mb-4 grid grid-cols-3 gap-1 rounded-lg p-1 lg:inline-grid lg:w-auto lg:grid-flow-col lg:auto-cols-max lg:grid-cols-none"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
      >
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/projects/${id}?tab=${t}`}
            aria-current={tab === t ? "page" : undefined}
            className="flex min-h-[40px] items-center justify-center rounded-md px-2 text-center text-xs lg:px-6"
            style={{
              background: tab === t ? "var(--accent-solid)" : "transparent",
              color: tab === t ? "#fff" : "var(--muted)",
            }}
          >
            {TAB_LABEL[t]}
          </Link>
        ))}
      </nav>

      {/* ---------------- Hari ini ---------------- */}
      {tab === "today" ? (
        <section>
          {!todayDay ? (
            <p
              className="rounded-xl border px-4 py-6 text-center text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
            >
              Hari ini ({today}) tidak termasuk dalam rentang project.
            </p>
          ) : (
            <div
              className="rounded-xl border px-4 py-3"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <p className="font-medium">{todayDay.date}</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                Tipe hari: {todayDay.dayType}
                {todayDay.isOutOfRange ? " · di luar rentang" : ""}
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {(["opening", "monitoring", "closing"] as const).map((phase) => {
                  const rows = dayReports.filter(
                    (r) => r.projectDayId === todayDay.id && r.phase === phase && r.status === "submitted",
                  );
                  const submitted = rows.length > 0;
                  const canFill = canSubmitPhase(session.user, facts, phase, todayDay.assignedUserId);
                  const href = `/projects/${id}/days/${todayDay.date}/${phase}`;
                  const label =
                    phase === "monitoring"
                      ? `${rows.length} laporan`
                      : rows.length > 0
                        ? "✓ terisi"
                        : "belum";

                  return (
                    <li key={phase} className="flex items-center justify-between gap-2">
                      <span style={{ color: "var(--muted)" }}>{phase}</span>
                      <span className="flex items-center gap-2">
                        <span>
                          {label}
                          {isWindowEnabled(phase, settings) && rows.some((r) => r.isLate) ? " · terlambat" : ""}
                        </span>
                        {canFill && (phase === "monitoring" || !submitted) ? (
                          <Link href={href} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--accent)]">
                            {submitted ? "+ Lagi" : "Isi"}
                          </Link>
                        ) : submitted ? (
                          <Link href={href} className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)]">
                            Lihat
                          </Link>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>

              <a
                href={`/reports/day/${todayDay.id}`}
                className="mt-3 flex min-h-tap items-center justify-center rounded-lg border px-4 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--accent)" }}
              >
                Lihat detail hari (timeline & review) →
              </a>
            </div>
          )}

          {openIssues.length > 0 ? (
            <div className="mt-3">
              <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
                Issue terbaru
              </h2>
              <ul className="flex flex-col gap-1">
                {openIssues.map((i) => (
                  <li
                    key={i.id}
                    className="rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                  >
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {i.code} · {i.severity}
                    </span>
                    <p>{i.title}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ---------------- Hari (kalender/list) ---------------- */}
      {tab === "days" ? (
        <section>
          <ul className="flex flex-col gap-2">
            {days.map((d) => {
              const rows = dayReports.filter((r) => r.projectDayId === d.id);
              const hasOpening = rows.some((r) => r.phase === "opening" && r.status === "submitted");
              const hasClosing = rows.some((r) => r.phase === "closing" && r.status === "submitted");
              const monitoring = rows.filter((r) => r.phase === "monitoring" && r.status === "submitted")
                .length;
              return (
                <li
                  key={d.id}
                  className="rounded-xl border px-4 py-3"
                  style={{
                    borderColor: "var(--border)",
                    background: "var(--surface)",
                    opacity: d.isOutOfRange ? 0.7 : 1,
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">
                        {d.date}
                        {d.date === today ? " · hari ini" : ""}
                      </p>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        Opening {hasOpening ? "✓" : "—"} · Monitoring {monitoring} · Closing{" "}
                        {hasClosing ? "✓" : "—"}
                        {d.isOutOfRange ? " · di luar rentang" : ""}
                        {d.reviewedAt ? " · reviewed" : ""}
                      </p>
                    </div>
                    <Link
                      href={`/reports/day/${d.id}`}
                      aria-label={`Lihat laporan ${d.date}`}
                      className="inline-flex min-h-10 shrink-0 items-center rounded-lg border border-[var(--border)] px-2 text-xs font-medium text-[var(--accent)]"
                    >
                      Lihat laporan
                    </Link>
                  </div>

                  {canManage ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <form action={setDayTypeAction} className="flex items-center gap-1">
                        <input type="hidden" name="projectDayId" value={d.id} />
                        <select
                          name="dayType"
                          defaultValue={d.dayType}
                          aria-label={`Tipe hari ${d.date}`}
                          className="min-h-[34px] rounded-md border px-2 text-xs"
                          style={{
                            background: "var(--surface)",
                            borderColor: "var(--border)",
                            color: "var(--fg)",
                          }}
                        >
                          <option value="loading_in">loading_in</option>
                          <option value="event">event</option>
                          <option value="loading_out">loading_out</option>
                        </select>
                        <button
                          type="submit"
                          className="min-h-[34px] rounded-md border px-2 text-xs"
                          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                        >
                          Set
                        </button>
                      </form>

                      <form action={assignOfficerAction} className="flex items-center gap-1">
                        <input type="hidden" name="projectDayId" value={d.id} />
                        <select
                          name="userId"
                          defaultValue={d.assignedUserId ?? ""}
                          aria-label={`Petugas ${d.date}`}
                          className="min-h-[34px] rounded-md border px-2 text-xs"
                          style={{
                            background: "var(--surface)",
                            borderColor: "var(--border)",
                            color: "var(--fg)",
                          }}
                        >
                          <option value="">Petugas: semua Head Crew</option>
                          {members.filter((m) => m.roleInProject !== "admin_project").map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          className="min-h-[34px] rounded-md border px-2 text-xs"
                          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
                        >
                          Set
                        </button>
                      </form>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* ---------------- Checklist ---------------- */}
      {tab === "checklist" ? (
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="section-title">{editingChecklist ? "Edit checklist" : "Checklist project"}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {editingChecklist ? "Perubahan berlaku untuk pengisian berikutnya. Laporan yang sudah dikirim tetap utuh." : `${checklist.length} poin aktif`}
              </p>
            </div>
            {canManage && !editingChecklist ? <Link className="btn-primary" href={`/projects/${id}?tab=checklist&edit=1`}>Edit checklist</Link> : null}
          </div>
          {editingChecklist ? (
            <ProjectChecklistEditor
              projectId={id}
              version={checklistEditVersion(checklist)}
              initialRows={checklist.map(({ id, phase, label, description, categoryName, isRequired, requiresPhoto }) => ({
                id, phase, label, description, categoryName, isRequired, requiresPhoto,
              }))}
            />
          ) : (
            <>
              {saved === "1" && canManage ? <p role="status" className="tone-success mb-3 rounded-lg px-3 py-2 text-sm">Checklist tersimpan.</p> : null}
              <div className="space-y-3">
                {PHASES.map((phase) => {
                  const rows = checklist.filter((row) => row.phase === phase);
                  return (
                    <section key={phase} className="surface-card p-4">
                      <h3 className="section-title">{phaseLabel[phase]} <span className="status-badge tone-neutral">{rows.length}</span></h3>
                      {rows.length === 0 ? <p className="mt-2 text-sm text-[var(--muted)]">Belum ada poin.</p> : (
                        <ol className="mt-2 divide-y divide-[var(--border)]">
                          {rows.map((row) => (
                            <li key={row.id} className="break-words py-2 text-sm">
                              <p className="font-medium">{row.label}</p>
                              {row.description ? <p className="text-[var(--muted)]">{row.description}</p> : null}
                              <p className="text-xs text-[var(--muted)]">
                                {[row.categoryName, row.isRequired ? "Wajib" : "Opsional", row.requiresPhoto ? "Wajib foto" : ""].filter(Boolean).join(" · ")}
                              </p>
                            </li>
                          ))}
                        </ol>
                      )}
                    </section>
                  );
                })}
              </div>
              {checklistHistory.length > 0 ? (
                <details className="surface-card mt-4 p-4">
                  <summary className="cursor-pointer text-sm font-semibold">Riwayat perubahan checklist</summary>
                  <ol className="mt-2 divide-y divide-[var(--border)]">
                    {checklistHistory.map(({ id: changeId, at, editorName, changes }) => (
                      <li key={changeId} className="py-3 text-sm">
                        <p className="font-medium">{editorName}</p>
                        <p className="text-xs text-[var(--muted)]">{formatReportTimestamp(at, project.timezone)}</p>
                        <ul className="mt-1 list-disc space-y-1 pl-5 text-[var(--muted)]">
                          {changes.map(({ before, after }) => {
                            const item = after ?? before!;
                            const action = !before ? "Ditambah" : !after ? "Dinonaktifkan" : "Diubah";
                            return (
                              <li key={item.id} className="break-words">
                                {action} · {phaseLabel[item.phase]} · {before && after && before.label !== after.label ? `${before.label} → ` : ""}{item.label}
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {/* ---------------- Members ---------------- */}
      {tab === "members" ? (
        <section>
          <h2 className="section-title mb-3">Akses member</h2>
          <ul className="flex flex-col gap-2">
            {members.map((m) => (
              <li
                key={m.userId}
                className="rounded-xl border px-4 py-3"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {m.email}
                      {m.isCrossDivision ? " · divisi lain" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px]" style={{ background: "var(--border)" }}>
                    {projectRoleLabel[m.roleInProject]}
                  </span>
                </div>

                {canManage ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <form action={setMemberRoleAction} className="flex flex-wrap gap-2">
                      <input type="hidden" name="projectId" value={id} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <select name="roleInProject" defaultValue={m.roleInProject} aria-label={`Akses ${m.name}`} className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm">
                        {PROJECT_ROLES.map((role) => <option key={role} value={role}>{projectRoleOptionLabel[role]}</option>)}
                      </select>
                      <button type="submit" className="btn-secondary">Simpan akses</button>
                    </form>
                    <form action={removeMemberAction}>
                      <input type="hidden" name="projectId" value={id} />
                      <input type="hidden" name="userId" value={m.userId} />
                      <button
                        type="submit"
                        className="min-h-[34px] rounded-md border px-2 text-xs"
                        style={{ borderColor: "var(--border)", color: "#dc2626" }}
                      >
                        Hapus
                      </button>
                    </form>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {members.length === 0 ? (
            <p
              className="rounded-xl border px-4 py-6 text-center text-sm"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
            >
              Belum ada member.
            </p>
          ) : null}

          {canManage && candidates.length > 0 ? (
            <form
              action={addMemberAction}
              className="mt-3 flex flex-col gap-2 rounded-xl border p-3"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <input type="hidden" name="projectId" value={id} />
              <p className="text-sm font-medium">Tambah member</p>
              <select
                name="userId"
                required
                aria-label="Pilih user"
                className="min-h-tap rounded-lg border px-3 text-sm"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
              >
                <option value="">Pilih user…</option>
                {candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.name} ({c.email})
                    {c.inProjectDivision ? "" : " — divisi lain"}
                  </option>
                ))}
              </select>
              <select
                name="roleInProject"
                aria-label="Akses dalam project"
                defaultValue="crew"
                className="min-h-tap rounded-lg border px-3 text-sm"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
              >
                {PROJECT_ROLES.map((role) => <option key={role} value={role}>{projectRoleOptionLabel[role]}</option>)}
              </select>
              <p className="text-xs text-[var(--muted)]">Akses member berlaku di project ini. Admin Project hanya bisa melihat dan mengunduh laporan.</p>
              <button
                type="submit"
                className="min-h-tap rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ background: "var(--accent-solid)" }}
              >
                Tambah
              </button>
            </form>
          ) : null}
        </section>
      ) : null}

      {/* ---------------- Settings ---------------- */}
      {editingDetails ? (
        <ProjectDetailsForm
          key={project.updatedAt}
          projectId={id}
          updatedAt={project.updatedAt}
          datesLocked={project.status === "completed" || project.status === "archived"}
          canChangeOwnerDivision={canDeleteProject(session.user)}
          divisionOptions={divisionOptions}
          initial={{
            code: project.code, name: project.name, client: project.client ?? "", venue: project.venue,
            address: project.address ?? "", description: project.description ?? "", startDate: project.startDate,
            endDate: project.endDate, ownerDivisionId: project.ownerDivisionId, additionalDivisionIds: facts.divisionIds,
          }}
        />
      ) : tab === "settings" ? (
        <section className="flex flex-col gap-4">
          {saved === "details" && canManage ? <p role="status" className="tone-success rounded-lg px-3 py-2 text-sm">Detail project tersimpan.</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">Detail project</h2>
            {canManage ? <Link className="btn-primary" href={`/projects/${id}?tab=settings&edit=1`}>Edit detail project</Link> : null}
          </div>
          <dl
            className="rounded-xl border px-4 py-3 text-sm"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            {[
              ["Nomor project", project.code || "—"],
              ["Klien", project.client ?? "—"],
              ["Venue", project.venue],
              ["Alamat", project.address ?? "—"],
              ["Deskripsi", project.description ?? "—"],
              ["Rentang", `${project.startDate} → ${project.endDate}`],
              ["Timezone", project.timezone],
              [
                "Window opening",
                settings.openingWindowEnabled ? `${project.openingWindowStart}–${project.openingWindowEnd}` : "Nonaktif — bebas jam",
              ],
              [
                "Window closing",
                settings.closingWindowEnabled ? `${project.closingWindowStart}–${project.closingWindowEnd}` : "Nonaktif — bebas jam",
              ],
              ["Jumlah hari", String(days.length)],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-0.5">
                <dt style={{ color: "var(--muted)" }}>{k}</dt>
                <dd className="text-right">{v}</dd>
              </div>
            ))}
          </dl>

          {canExport ? (
            <div className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <p className="mb-2 text-sm font-medium">Export PDF rekap</p>
              <ExportPdfForm
                action={exportProjectPdfAction}
                hidden={{ projectId: id }}
                submitLabel="Export PDF rekap project"
                showDateRange
                defaultFrom={project.startDate}
                defaultTo={project.endDate}
                hint="Maksimal 31 hari per PDF."
              />
            </div>
          ) : null}

          {canManage ? (
            <div className="rounded-xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
              <p className="mb-2 text-sm font-medium">Ubah status</p>
              <form action={setProjectStatusAction} className="flex flex-col gap-2">
                <input type="hidden" name="projectId" value={id} />
                <select
                  name="status"
                  defaultValue={project.status}
                  aria-label="Status project"
                  className="min-h-tap rounded-lg border px-3 text-sm"
                  style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Aktif</option>
                  <option value="completed">Selesai</option>
                  <option value="archived">Arsip</option>
                </select>
                <input
                  name="reason"
                  placeholder="Alasan (wajib saat buka kembali)"
                  aria-label="Alasan perubahan status"
                  className="min-h-tap rounded-lg border px-3 text-sm"
                  style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
                />
                <button
                  type="submit"
                  className="min-h-tap rounded-lg px-4 py-2 text-sm font-medium text-white"
                  style={{ background: "var(--accent-solid)" }}
                >
                  Simpan status
                </button>
              </form>
              <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
                Aktifkan kembali project yang selesai atau diarsipkan untuk mengubah tanggal.
              </p>
            </div>
          ) : null}
        </section>
      ) : null}
    </AppShell>
  );
}
