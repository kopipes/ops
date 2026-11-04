import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { MasterNav } from "@/components/master/MasterNav";
import { TemplateEditor } from "@/components/master/TemplateEditor";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { divisions } from "@/server/db/schema";
import { listChecklistItems } from "@/server/services/checklist-items";
import { isAdmin, isManager } from "@/server/permissions";
import { saveTemplateAction } from "@/app/master-actions";

export const metadata = { title: "Template Baru — Pulse" };

export default async function NewTemplatePage() {
  const session = await requireUser();
  if (!isAdmin(session.user) && !isManager(session.user)) redirect("/");

  const db = getDb();
  const [items, divisionRows] = await Promise.all([
    listChecklistItems(db, session.user),
    db.select({ id: divisions.id, name: divisions.name }).from(divisions).orderBy(asc(divisions.name)),
  ]);

  return (
    <AppShell>
      <MasterNav active="templates" isAdmin={isAdmin(session.user)} />
      <h1 className="mb-4 text-xl font-semibold">Template Baru</h1>
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
        submitLabel="Simpan template"
      />
    </AppShell>
  );
}
