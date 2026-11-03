import { redirect } from "next/navigation";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { IssueForm } from "@/components/issues/IssueForm";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { issueCategories, projectDays, projects } from "@/server/db/schema";
import { visibleProjectIds } from "@/server/visibility";
import { listMembers } from "@/server/services/members";
import { createIssueAction } from "@/app/issue-actions";
import { toLocalDate } from "@/lib/datetime";

export const metadata = { title: "Issue Baru — Ops" };

export default async function NewIssuePage({
  searchParams,
}: {
  searchParams: Promise<{
    projectId?: string;
    dayId?: string;
    phase?: string;
    title?: string;
    description?: string;
    checkResultId?: string;
    reportId?: string;
  }>;
}) {
  const session = await requireUser();
  const params = await searchParams;
  const db = getDb();

  const ids = await visibleProjectIds(db, session.user);
  if (ids.length === 0) redirect("/issues");

  const projectRows = await db
    .select({ id: projects.id, name: projects.name, code: projects.code })
    .from(projects)
    .where(and(inArray(projects.id, ids), isNull(projects.deletedAt)))
    .orderBy(asc(projects.name));

  const categories = await db
    .select({ id: issueCategories.id, name: issueCategories.name })
    .from(issueCategories)
    .where(eq(issueCategories.isActive, true))
    .orderBy(asc(issueCategories.sortOrder));

  if (categories.length === 0) {
    return (
      <AppShell>
        <h1 className="mb-4 text-xl font-semibold">Issue Baru</h1>
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Kategori issue belum dibuat. Hubungi Admin.
        </p>
      </AppShell>
    );
  }

  // Resolve the target project/day.
  const projectId = params.projectId ?? projectRows[0]?.id ?? "";
  let dayId = params.dayId ?? "";
  if (!dayId && projectId) {
    const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (project) {
      const today = toLocalDate(Date.now(), project.timezone);
      const day = await db
        .select({ id: projectDays.id })
        .from(projectDays)
        .where(and(eq(projectDays.projectId, projectId), eq(projectDays.date, today)))
        .get();
      dayId = day?.id ?? "";
    }
  }

  const members = projectId ? await listMembers(db, projectId) : [];

  return (
    <AppShell contentWidth="form">
      <h1 className="mb-4 text-xl font-semibold">Issue Baru</h1>
      <IssueForm
        action={createIssueAction}
        projects={projectRows}
        categories={categories}
        members={members.map((m) => ({ userId: m.userId, name: m.name }))}
        initial={{
          projectId,
          projectDayId: dayId,
          phase: params.phase ?? "",
          title: params.title ?? "",
          description: params.description ?? "",
          photoIds: [],
          checkResultId: params.checkResultId,
          reportId: params.reportId,
        }}
        submitLabel="Buat issue"
      />
    </AppShell>
  );
}
