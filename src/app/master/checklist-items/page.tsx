import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { AppShell } from "@/components/AppShell";
import { MasterNav } from "@/components/master/MasterNav";
import { ChecklistItemList } from "@/components/master/ChecklistItemList";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { divisions } from "@/server/db/schema";
import { listChecklistItems } from "@/server/services/checklist-items";
import { listChecklistCategories } from "@/server/services/categories";
import { isAdmin, isManager } from "@/server/permissions";
import {
  deactivateChecklistItemAction,
  reactivateChecklistItemAction,
  saveChecklistItemAction,
} from "@/app/master-actions";

export const metadata = { title: "Master Checklist — Pulse" };

export default async function ChecklistItemsPage() {
  const session = await requireUser();

  // §12: /master/* is admin + manager.
  if (!isAdmin(session.user) && !isManager(session.user)) redirect("/");

  const db = getDb();
  const [items, categories, divisionRows] = await Promise.all([
    listChecklistItems(db, session.user, { includeInactive: true }),
    listChecklistCategories(db),
    db
      .select({ id: divisions.id, name: divisions.name })
      .from(divisions)
      .orderBy(asc(divisions.name)),
  ]);

  return (
    <AppShell>
      <MasterNav active="items" isAdmin={isAdmin(session.user)} />
      <ChecklistItemList
        items={items.map((i) => ({
          id: i.id,
          label: i.label,
          description: i.description ?? "",
          phase: i.phase,
          categoryId: i.categoryId,
          categoryName: i.categoryName,
          divisionId: i.divisionId ?? "",
          divisionName: i.divisionName,
          isRequired: i.isRequired,
          requiresPhoto: i.requiresPhoto,
          sortOrder: i.sortOrder,
          isActive: i.isActive,
          isUsed: i.isUsed,
        }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        divisions={divisionRows}
        isAdmin={isAdmin(session.user)}
        managerDivisionId={session.user.divisionIds[0] ?? null}
        saveAction={saveChecklistItemAction}
        deactivateAction={deactivateChecklistItemAction}
        reactivateAction={reactivateChecklistItemAction}
      />
    </AppShell>
  );
}
