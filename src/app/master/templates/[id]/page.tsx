import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ChecklistEditor } from "@/components/project/ProjectChecklistEditor";
import { DivisionTemplateUpload } from "@/components/master/DivisionTemplateUpload";
import { DivisionTemplateStatusForm } from "@/components/master/DivisionTemplateStatusForm";
import { saveDivisionTemplateAction } from "@/app/division-template-actions";
import { requireUserWithoutPasswordChange } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { canCreateProject } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";
import { readDivisionTemplate } from "@/server/services/division-templates";
import { phaseLabel } from "@/lib/schemas";

export const metadata = { title: "Checklist Template Divisi — Pulse" };

export default async function TemplateDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; saved?: string; replaced?: string; archived?: string; restored?: string }>;
}) {
  const { user } = await requireUserWithoutPasswordChange();
  if (!canCreateProject(user)) redirect("/");
  const { id } = await params;
  const result = await searchParams;
  let template: ReturnType<typeof readDivisionTemplate>;
  try {
    template = readDivisionTemplate(getDb(), user, id);
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError) notFound();
    throw error;
  }
  const status = result.created ? "Template dibuat." : result.saved ? "Template tersimpan."
    : result.replaced ? "Isi template berhasil diganti." : result.archived ? "Template diarsipkan."
      : result.restored ? "Template dipulihkan." : "";
  const canEdit = template.isActive && template.divisionActive;

  return (
    <AppShell contentWidth="form">
      <Link className="mb-3 inline-flex text-sm font-medium text-[var(--accent)]" href="/master/templates">← Template Divisi</Link>
      <div className="mb-4">
        <h1 className="page-title break-words">{template.name}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {template.divisionName} · {template.rows.length} poin
          {template.isActive ? template.divisionActive ? "" : " · Divisi nonaktif" : " · Diarsipkan"}
        </p>
        {template.description ? <p className="mt-2 text-sm text-[var(--muted)]">{template.description}</p> : null}
      </div>
      {status ? <p role="status" className="status-badge tone-ok mb-4">{status}</p> : null}
      <div className="mb-5 grid gap-3">
        <div className="flex flex-wrap gap-2">
          <a className="btn-secondary" href={`/api/division-templates/workbook?id=${encodeURIComponent(id)}`}>Unduh Excel</a>
          {template.isActive || (template.divisionActive && template.rows.length) ? (
            <DivisionTemplateStatusForm id={id} version={template.version} active={template.isActive} />
          ) : null}
        </div>
        {canEdit ? (
          <details className="surface-card px-4 py-3" key={`excel-${template.version}`}>
            <summary className="cursor-pointer font-medium">Ganti isi dari Excel</summary>
            <p className="mb-3 mt-2 text-sm text-[var(--muted)]">File ini akan mengganti semua poin di template. Periksa jumlah poin yang berubah sebelum menyimpan.</p>
            <DivisionTemplateUpload templateId={id} />
          </details>
        ) : null}
      </div>
      {canEdit ? (
        <ChecklistEditor key={template.version} action={saveDivisionTemplateAction} id={id} version={String(template.version)}
          templateName={template.name} cancelHref="/master/templates"
          initialRows={template.rows.map(({ templateId: _templateId, sortOrder: _order, ...row }) => row)} />
      ) : (
        <ul className="surface-card divide-y divide-[var(--border)]">
          {template.rows.map((row) => <li key={row.id} className="px-4 py-3">
            <div className="break-words text-sm font-medium">{row.label}</div>
            <p className="text-xs text-[var(--muted)]">{phaseLabel[row.phase]} · {row.categoryName}</p>
          </li>)}
        </ul>
      )}
    </AppShell>
  );
}
