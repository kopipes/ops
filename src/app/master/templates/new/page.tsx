import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DivisionTemplateUpload } from "@/components/master/DivisionTemplateUpload";
import { requireUserWithoutPasswordChange } from "@/server/auth/current-user";
import { canCreateProject, isAdmin } from "@/server/permissions";
import { listTemplateDivisions } from "@/server/services/division-templates";
import { getDb } from "@/server/db";

export const metadata = { title: "Upload Template Divisi — Pulse" };

export default async function NewTemplatePage() {
  const { user } = await requireUserWithoutPasswordChange();
  if (!canCreateProject(user)) redirect("/");
  const divisions = listTemplateDivisions(getDb(), user);
  return (
    <AppShell contentWidth="form">
      <Link className="mb-3 inline-flex text-sm font-medium text-[var(--accent)]" href="/master/templates">← Template Divisi</Link>
      <h1 className="page-title">Buat template dari Excel</h1>
      <p className="mb-4 mt-1 text-sm text-[var(--muted)]">Satu file menjadi satu template. Isi poin di sheet Checklist, lalu unggah kembali. Baris bertanda CONTOH dilewati.</p>
      <a className="btn-secondary mb-4" href="/api/division-templates/workbook">Unduh template Excel</a>
      {divisions.length ? (
        <div className="surface-card p-4 sm:p-5">
          <DivisionTemplateUpload divisions={divisions} defaultDivisionId={isAdmin(user) ? user.divisionIds.find((id) => divisions.some((division) => division.id === id)) : undefined} />
        </div>
      ) : <p className="surface-card p-4 text-sm">Akunmu belum punya divisi aktif. Minta Admin menambahkan divisi untuk akunmu.</p>}
    </AppShell>
  );
}
