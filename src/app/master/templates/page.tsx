import { redirect } from "next/navigation";
import { and, asc, desc, isNull } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { MasterNav } from "@/components/master/MasterNav";
import { TemplateList } from "@/components/master/TemplateList";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { projects } from "@/server/db/schema";
import { listTemplates } from "@/server/services/templates";
import { visibleProjectIds } from "@/server/visibility";
import { isAdmin, isManager } from "@/server/permissions";
import { inArray } from "drizzle-orm";
import {
  deactivateTemplateAction,
  duplicateTemplateAction,
  templateFromProjectAction,
} from "@/app/master-actions";

export const metadata = { title: "Template Checklist — Pulse" };

export default async function TemplatesPage() {
  const session = await requireUser();
  if (!isAdmin(session.user) && !isManager(session.user)) redirect("/");

  const db = getDb();
  const templates = await listTemplates(db, session.user, { includeInactive: true });

  const projectIds = await visibleProjectIds(db, session.user, { includeArchived: true });
  const projectRows =
    projectIds.length === 0
      ? []
      : await db
          .select({ id: projects.id, name: projects.name, code: projects.code })
          .from(projects)
          .where(and(inArray(projects.id, projectIds), isNull(projects.deletedAt)))
          .orderBy(desc(projects.startDate), asc(projects.name));

  return (
    <AppShell>
      <MasterNav active="templates" isAdmin={isAdmin(session.user)} />
      <TemplateList
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          divisionName: t.divisionName,
          isActive: t.isActive,
          itemCount: t.itemCount,
          phases: t.phases,
        }))}
        projects={projectRows}
        duplicateAction={duplicateTemplateAction}
        fromProjectAction={templateFromProjectAction}
        deactivateAction={deactivateTemplateAction}
      />
    </AppShell>
  );
}
