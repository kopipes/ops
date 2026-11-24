"use client";

import { useActionState } from "react";
import { assignLegacyTemplateAction } from "@/app/division-template-actions";

export function LegacyTemplateAssignment({ templates, divisions }: {
  templates: { id: string; name: string; itemCount: number }[];
  divisions: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(assignLegacyTemplateAction, {});
  const field = "min-h-11 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2";
  return (
    <form action={action} className="surface-card p-4">
      <fieldset className="grid gap-4" disabled={pending}>
        <label className="grid gap-1 text-sm">Template lama
          <select name="templateId" className={field} required defaultValue="">
            <option value="">Pilih template…</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.itemCount} poin</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Divisi tujuan
          <select name="divisionId" className={field} required defaultValue="">
            <option value="">Pilih divisi…</option>
            {divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">Nama baru (opsional)
          <input name="name" className={field} minLength={3} maxLength={100} />
        </label>
        {state.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
        <button type="submit" className="btn-primary justify-self-start">{pending ? "Menyimpan…" : "Salin ke divisi"}</button>
      </fieldset>
    </form>
  );
}
