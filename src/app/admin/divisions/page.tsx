import { AppShell } from "@/components/AppShell";
import { AdminNav } from "@/components/admin/AdminNav";
import { DivisionManager } from "@/components/admin/DivisionManager";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { listDivisions } from "@/server/services/admin";
import { isAdmin } from "@/server/permissions";
import { saveDivisionAction, toggleDivisionActiveAction } from "@/app/admin-actions";

export const metadata = { title: "Admin — Divisi" };

export default async function AdminDivisionsPage() {
  const session = await requireUser();

  if (!isAdmin(session.user)) {
    return (
      <AppShell>
        <h1 className="mb-4 text-xl font-semibold">Divisi</h1>
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Halaman ini hanya untuk Admin.
        </p>
      </AppShell>
    );
  }

  const rows = await listDivisions(getDb(), session.user);

  return (
    <AppShell>
      <AdminNav active="divisions" />
      <DivisionManager rows={rows} saveAction={saveDivisionAction} toggleAction={toggleDivisionActiveAction} />
    </AppShell>
  );
}
