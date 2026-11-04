import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { MasterNav } from "@/components/master/MasterNav";
import { CategoryManager } from "@/components/master/CategoryManager";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { listIssueCategories } from "@/server/services/categories";
import { isAdmin } from "@/server/permissions";
import { deactivateIssueCategoryAction, saveIssueCategoryAction } from "@/app/master-actions";

export const metadata = { title: "Kategori Issue — Pulse" };

export default async function IssueCategoriesPage() {
  const session = await requireUser();
  // §12: /master/issue-categories is admin-only.
  if (!isAdmin(session.user)) redirect("/");

  const rows = await listIssueCategories(getDb(), { includeInactive: true });

  return (
    <AppShell>
      <MasterNav active="issue-categories"  isAdmin />
      <CategoryManager
        title="Kategori Issue"
        rows={rows}
        saveAction={saveIssueCategoryAction}
        deactivateAction={deactivateIssueCategoryAction}
        withMasterNav
      />
    </AppShell>
  );
}
