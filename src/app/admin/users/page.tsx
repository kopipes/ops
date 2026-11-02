import { AppShell } from "@/components/AppShell";
import { AdminNav } from "@/components/admin/AdminNav";
import { UserManager } from "@/components/admin/UserManager";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { listActiveDivisions, listUsersAdmin } from "@/server/services/admin";
import { isAdmin } from "@/server/permissions";
import {
  resetPasswordAction,
  saveUserAction,
  toggleUserActiveAction,
} from "@/app/admin-actions";

export const metadata = { title: "Admin — User" };

export default async function AdminUsersPage() {
  const session = await requireUser();

  // §12: /admin/users is admin-only, enforced server-side.
  if (!isAdmin(session.user)) {
    return (
      <AppShell>
        <h1 className="mb-4 text-xl font-semibold">User</h1>
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Halaman ini hanya untuk Admin.
        </p>
      </AppShell>
    );
  }

  const db = getDb();
  const [rows, divisions] = await Promise.all([
    listUsersAdmin(db, session.user),
    listActiveDivisions(db),
  ]);

  return (
    <AppShell>
      <AdminNav active="users" />
      <UserManager
        rows={rows.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          role: u.role,
          primaryDivisionId: u.primaryDivisionId,
          primaryDivisionName: u.primaryDivisionName,
          divisionIds: u.divisionIds,
          mustChangePassword: u.mustChangePassword,
          isActive: u.isActive,
          lastLoginAt: u.lastLoginAt,
        }))}
        divisions={divisions.map((d) => ({ id: d.id, name: d.name }))}
        saveAction={saveUserAction}
        resetAction={resetPasswordAction}
        toggleAction={toggleUserActiveAction}
        currentUserId={session.user.id}
      />
    </AppShell>
  );
}
