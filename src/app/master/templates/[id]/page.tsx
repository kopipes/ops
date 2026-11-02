import { notFound, redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { MasterNav } from "@/components/master/MasterNav";
import { TemplateEditor, type SelectedItem } from "@/components/master/TemplateEditor";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { divisions } from "@/server/db/schema";
import { listChecklistItems } from "@/server/services/checklist-items";
import { getTemplate } from "@/server/services/templates";
import { isAdmin, isManager } from "@/server/permissions";
import { saveTemplateAction } from "@/app/master-actions";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireUser();
  if (!isAdmin(session.user) && !isManager(session.user)) redirect("/");

  const { id } = await params;
  const db = getDb();
  const [template, items, divisionRows] = await Promise.all([
    getTemplate(db, session.user, id),
    listChecklistItems(db, session.user),
    db.select({ id: divisions.id, name: divisions.name }).from(divisions).orderBy(asc(divisions.name)),
  ]);

  if (!template) notFound();

  const initialItems: SelectedItem[] = template.items.map((i) => ({
    checklistItemId: i.checklistItemId,
    isRequiredOverride:
      i.isRequiredOverride === null ? "inherit" : i.isRequiredOverride ? "true" : "false",
    requiresPhotoOverride:
      i.requiresPhotoOverride === null ? "inherit" : i.requiresPhotoOverride ? "true" : "false",
  }));

  return (
    <AppShell>
      <MasterNav active="templates" isAdmin={isAdmin(session.user)} />
      <h1 className="mb-4 text-xl font-semibold">Edit Template</h1>
      <TemplateEditor
        action={saveTemplateAction}
        availableItems={items.map((i) => ({
          id: i.id,
          label: i.label,
          phase: i.phase,
          categoryName: i.categoryName,
          isRequired: i.isRequired,
          requiresPhoto: i.requiresPhoto,
          divisionName: i.divisionName,
        }))}
        divisions={divisionRows}
        isAdmin={isAdmin(session.user)}
        managerDivisionId={session.user.divisionIds[0] ?? null}
        initial={{
          id: template.summary.id,
          name: template.summary.name,
          description: template.summary.description ?? "",
          divisionId: template.summary.divisionId ?? "",
          items: initialItems,
        }}
        submitLabel="Simpan perubahan"
      />
    </AppShell>
  );
}
