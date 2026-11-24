import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { LegacyTemplateAssignment } from "@/components/master/LegacyTemplateAssignment";
import { requireUserWithoutPasswordChange } from "@/server/auth/current-user";
import { isAdmin } from "@/server/permissions";
import { getDb } from "@/server/db";
import { listTemplateDivisions, listUnassignedLegacyTemplates } from "@/server/services/division-templates";

export const metadata = { title: "Template Lama — Pulse" };

export default async function LegacyTemplatePage() {
  const { user } = await requireUserWithoutPasswordChange();
  if (!isAdmin(user)) redirect("/master/templates");
  const db = getDb();
  const templates = listUnassignedLegacyTemplates(db, user);
  const divisions = listTemplateDivisions(db, user);
  return (
    <AppShell contentWidth="form">
      <Link className="mb-3 inline-flex text-sm font-medium text-[var(--accent)]" href="/master/templates">← Template Divisi</Link>
      <h1 className="page-title">Template lama tanpa divisi</h1>
      <p className="mb-4 mt-1 text-sm text-[var(--muted)]">Pilih divisi agar checklist lama bisa dipakai untuk project baru.</p>
      {templates.length && divisions.length ? (
        <LegacyTemplateAssignment templates={templates} divisions={divisions} />
      ) : <p className="surface-card p-4 text-sm">{templates.length ? "Belum ada divisi aktif." : "Semua template lama dengan isi sudah memiliki divisi."}</p>}
    </AppShell>
  );
}
