"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { saveProjectChecklistAction, type ProjectActionState } from "@/app/project-actions";
import { PHASES, phaseLabel, type ProjectChecklistEdit } from "@/lib/schemas";

type Row = ProjectChecklistEdit["rows"][number] & { key: string };
type Phase = Row["phase"];

const field = "w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 text-sm";
const moveButton = "min-h-11 min-w-11 rounded-lg border border-[var(--border)] disabled:opacity-30";
const initialState: ProjectActionState = {};

export function ProjectChecklistEditor({
  projectId, version, initialRows,
}: {
  projectId: string;
  version: string;
  initialRows: Array<Omit<Row, "id" | "key"> & { id: string }>;
}) {
  const [rows, setRows] = useState<Row[]>(() => initialRows.map((row) => ({ ...row, key: row.id })));
  const [state, save, pending] = useActionState(saveProjectChecklistAction, initialState);
  const [ready, setReady] = useState(false);
  const [validation, setValidation] = useState<string>();
  useEffect(() => setReady(true), []);

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  function add(phase: Phase) {
    setRows((current) => [...current, {
      key: crypto.randomUUID(),
      id: null, phase, label: "", description: null,
      categoryName: "Umum", isRequired: true, requiresPhoto: false,
    }]);
  }

  function move(key: string, target: string) {
    setRows((current) => {
      const next = [...current];
      const from = next.findIndex((row) => row.key === key);
      const to = next.findIndex((row) => row.key === target);
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  }

  return (
    <form action={save} onSubmit={(event) => {
      const empty = rows.find((row) => !row.label.trim());
      if (empty) {
        event.preventDefault();
        setValidation(`Isi nama poin di bagian ${phaseLabel[empty.phase]}.`);
        const input = document.getElementById(`checklist-label-${empty.key}`);
        const details = input?.closest("details");
        if (details) details.open = true;
        input?.focus();
      } else {
        setValidation(undefined);
      }
    }}>
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="rows" value={JSON.stringify(rows.map(({ key: _key, ...row }) => row))} />
      <fieldset className="flex flex-col gap-4" disabled={!ready || pending}>
        {PHASES.map((phase) => {
          const group = rows.filter((row) => row.phase === phase);
          return (
            <section key={phase} aria-label={phaseLabel[phase]} className="surface-card p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="section-title">{phaseLabel[phase]} <span className="status-badge tone-neutral">{group.length}</span></h2>
                <button type="button" className="btn-secondary" onClick={() => add(phase)} disabled={rows.length >= 1000}>+ Tambah poin</button>
              </div>
              {group.length === 0 ? <p className="mt-2 text-sm text-[var(--muted)]">Belum ada poin.</p> : (
                <ol className="mt-3 space-y-2">
                  {group.map((row, index) => (
                    <li key={row.key} className="rounded-xl border border-[var(--border)] p-2 sm:p-3">
                      <div className="relative">
                        <details className="min-w-0" open={row.id === null ? true : undefined}>
                          <summary className="min-h-11 cursor-pointer break-words py-2 pr-24 text-sm font-medium">
                            {row.label || "Poin baru"}
                          </summary>
                          <div className="grid gap-3 pb-2 sm:grid-cols-2">
                            <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">
                              Nama poin
                              <input id={`checklist-label-${row.key}`} className={field} maxLength={200} value={row.label} onChange={(e) => update(row.key, { label: e.target.value })} />
                            </label>
                            <label className="grid min-w-0 gap-1 text-sm">
                              Tahap
                              <select className={field} value={row.phase} onChange={(e) => update(row.key, { phase: e.target.value as Phase })}>
                                {PHASES.map((p) => <option key={p} value={p}>{phaseLabel[p]}</option>)}
                              </select>
                            </label>
                            <label className="grid min-w-0 gap-1 text-sm">
                              Kategori
                              <input className={field} maxLength={60} value={row.categoryName} onChange={(e) => update(row.key, { categoryName: e.target.value })} />
                            </label>
                            <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">
                              Petunjuk pengisian
                              <textarea className={field} rows={2} maxLength={500} value={row.description ?? ""} onChange={(e) => update(row.key, { description: e.target.value })} />
                            </label>
                            <label className="flex min-h-11 items-center gap-2 text-sm">
                              <input type="checkbox" checked={row.isRequired} onChange={(e) => update(row.key, { isRequired: e.target.checked })} />
                              Wajib diisi
                            </label>
                            <label className="flex min-h-11 items-center gap-2 text-sm">
                              <input type="checkbox" checked={row.requiresPhoto} onChange={(e) => update(row.key, { requiresPhoto: e.target.checked })} />
                              Wajib foto
                            </label>
                            <button type="button" className="w-fit min-h-11 px-1 text-sm font-medium text-red-700 dark:text-red-300" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>
                              {row.id ? "Nonaktifkan poin" : "Hapus poin baru"}
                            </button>
                          </div>
                        </details>
                        <div className="absolute right-0 top-0 flex gap-1">
                          <button type="button" className={moveButton} aria-label={`Naikkan ${row.label || "poin baru"}`} disabled={index === 0} onClick={() => move(row.key, group[index - 1].key)}>↑</button>
                          <button type="button" className={moveButton} aria-label={`Turunkan ${row.label || "poin baru"}`} disabled={index === group.length - 1} onClick={() => move(row.key, group[index + 1].key)}>↓</button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
        {validation || state.error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{validation || state.error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {!pending ? <Link className="btn-secondary" href={`/projects/${projectId}?tab=checklist`}>Batal</Link> : null}
          <button type="submit" className="btn-primary">{pending ? "Menyimpan…" : "Simpan checklist"}</button>
        </div>
      </fieldset>
    </form>
  );
}
