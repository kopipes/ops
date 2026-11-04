import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MasterNav } from "@/components/master/MasterNav";
import { CategoryManager } from "@/components/master/CategoryManager";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { listChecklistCategories } from "@/server/services/categories";
import { isAdmin } from "@/server/permissions";
import {
  deactivateChecklistCategoryAction,
  saveChecklistCategoryAction,
} from "@/app/master-actions";

export const metadata = { title: "Kategori Checklist — Pulse" };

export default async function ChecklistCategoriesPage() {
  const session = await requireUser();
  if (!isAdmin(session.user)) redirect("/");

  const rows = await listChecklistCategories(getDb(), { includeInactive: true });

  return (
    <AppShell>
      <MasterNav active="items"  isAdmin />
      <CategoryManager
        title="Kategori Checklist"
        rows={rows}
        saveAction={saveChecklistCategoryAction}
        deactivateAction={deactivateChecklistCategoryAction}
        withMasterNav
      />
    </AppShell>
  );
}
