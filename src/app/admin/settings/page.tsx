import { AppShell } from "@/components/AppShell";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getGlobalSettings } from "@/server/services/app-settings";
import { isAdmin } from "@/server/permissions";
import { saveSettingsAction } from "@/app/settings-actions";
import { SettingsForm } from "@/components/admin/SettingsForm";

export const metadata = { title: "Admin — Setelan" };

export default async function AdminSettingsPage() {
  const session = await requireUser();

  if (!isAdmin(session.user)) {
    return (
      <AppShell>
        <h1 className="mb-4 text-xl font-semibold">Setelan</h1>
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Halaman ini hanya untuk Admin.
        </p>
      </AppShell>
    );
  }

  const settings = await getGlobalSettings(getDb());

  return (
    <AppShell>
      <AdminNav active="settings" />
      <h1 className="mb-1 text-xl font-semibold">Setelan Global</h1>
      <p className="mb-4 text-xs" style={{ color: "var(--muted)" }}>
        Nilai default saat membuat project baru. Project yang sudah ada tidak berubah.
      </p>
      <SettingsForm action={saveSettingsAction} initial={settings} />
    </AppShell>
  );
}
