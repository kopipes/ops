import { redirect } from "next/navigation";
import { and, asc, eq, ne, isNull } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { ProjectWizard } from "@/components/project/ProjectWizard";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { divisions, users } from "@/server/db/schema";
import { listDivisionTemplates } from "@/server/services/division-templates";
import { generateProjectCode } from "@/server/services/projects";
import { getGlobalSettings } from "@/server/services/app-settings";
import { visibleProjectIds } from "@/server/visibility";
import { isAdmin, isManager } from "@/server/permissions";
import { projects } from "@/server/db/schema";
import { inArray } from "drizzle-orm";
import { saveProjectAction } from "@/app/project-actions";
import { toLocalDate } from "@/lib/datetime";

export const metadata = { title: "Project Baru — Pulse" };

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await requireUser();
  // §12: /projects/new is admin + manager.
  if (!isAdmin(session.user) && !isManager(session.user)) redirect("/");

  const { error } = await searchParams;
  const db = getDb();

  const [divisionRows, templates] = await Promise.all([
    db
      .select({ id: divisions.id, name: divisions.name, code: divisions.code })
      .from(divisions)
      .where(eq(divisions.isActive, true))
      .orderBy(asc(divisions.name)),
    listDivisionTemplates(db, session.user, true),
  ]);

  const settings = getGlobalSettings(db);
  const ownerDivisions = divisionRows.filter((division) => isAdmin(session.user) || session.user.divisionIds.includes(division.id));
  const defaultDivisionId = ownerDivisions.find((division) => session.user.divisionIds.includes(division.id))?.id ?? ownerDivisions[0]?.id ?? "";
  const defaultCode = settings.projectCodeRequired ? await generateProjectCode(db, {
    divisionCode: divisionRows.find((d) => d.id === defaultDivisionId)?.code ?? "PRJ",
    year: new Date().getFullYear(),
  }) : "";

  // Candidate projects for "copy from previous project".
  const projectIds = await visibleProjectIds(db, session.user, { includeArchived: true, workspaceOnly: true });
  const projectOptions =
    projectIds.length === 0
      ? []
      : await db
          .select({ id: projects.id, code: projects.code, name: projects.name })
          .from(projects)
          .where(and(inArray(projects.id, projectIds), isNull(projects.deletedAt)))
          .orderBy(asc(projects.name));

  // Member candidates: default filter is the project's divisions (§6.1 no.4).
  const memberRows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(users)
    .where(and(eq(users.isActive, true), ne(users.id, session.user.id)))
    .orderBy(asc(users.name));

  const memberDivisionRows = await db
    .select({ userId: users.id, divisionId: divisions.id, divisionName: divisions.name })
    .from(users)
    .innerJoin(divisions, eq(divisions.id, users.primaryDivisionId))
    .where(eq(users.isActive, true));

  const memberOptions = memberRows.map((m) => {
    const divs = memberDivisionRows.filter((d) => d.userId === m.userId);
    return {
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.role,
      divisionNames: divs.map((d) => d.divisionName),
      inProjectDivision: divs.some((d) => d.divisionId === defaultDivisionId),
    };
  });

  /*
   * "Today" for the date defaults must be evaluated in the project timezone,
   * not UTC. `toISOString()` is UTC, so a user opening the wizard at 00:30 WIB
   * would get yesterday's date pre-filled and the project would not cover the
   * day they are actually working on.
   */
  const todayIso = toLocalDate(Date.now(), settings.defaultTimezone);

  return (
    <AppShell contentWidth="form">
      <h1 className="mb-4 text-xl font-semibold">Project Baru</h1>
      <ProjectWizard
        action={saveProjectAction}
        divisions={divisionRows.map((d) => ({ id: d.id, name: d.name }))}
        ownerDivisions={ownerDivisions}
        templates={templates}
        projects={projectOptions}
        members={memberOptions}
        currentUserId={session.user.id}
        defaultDivisionId={defaultDivisionId}
        defaultCode={defaultCode}
        projectCodeRequired={settings.projectCodeRequired}
        isAdmin={isAdmin(session.user)}
        todayIso={todayIso}
        errorFromQuery={error}
        defaults={{
          openingWindowEnabled: settings.openingWindowEnabled,
          closingWindowEnabled: settings.closingWindowEnabled,
          openingWindowStart: settings.defaultOpeningWindowStart,
          openingWindowEnd: settings.defaultOpeningWindowEnd,
          closingWindowStart: settings.defaultClosingWindowStart,
          closingWindowEnd: settings.defaultClosingWindowEnd,
          timezone: settings.defaultTimezone,
        }}
      />
    </AppShell>
  );
}
