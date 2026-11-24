"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import type { DivisionTemplatePreview } from "@/lib/division-templates";
import { PHASES, phaseLabel } from "@/lib/schemas";

type Division = { id: string; name: string };

const field = "w-full min-h-11 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm";

export function DivisionTemplateUpload({
  divisions = [], defaultDivisionId = "", templateId = "", name: initialName = "",
}: {
  divisions?: Division[];
  defaultDivisionId?: string;
  templateId?: string;
  name?: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(initialName);
  const [divisionId, setDivisionId] = useState(defaultDivisionId || (divisions.length === 1 ? divisions[0].id : ""));
  const [preview, setPreview] = useState<DivisionTemplatePreview>();
  const [error, setError] = useState("");
  const [requestId, setRequestId] = useState("");
  const [pending, setPending] = useState<"preview" | "commit">();
  const [finished, setFinished] = useState(false);
  const replacing = Boolean(templateId);

  function resetPreview() {
    setPreview(undefined);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || finished || !formRef.current) return;
    const commit = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "commit";
    if (commit && (!preview || preview.rows.some((row) => row.error))) return;
    const mode = commit ? "commit" : "preview";
    const id = commit ? requestId : crypto.randomUUID();
    const form = new FormData(formRef.current);
    form.set("requestId", id);
    form.set("mode", mode);
    if (commit && preview) form.set("hash", preview.hash);
    else setPreview(undefined);
    setPending(mode);
    setError("");
    try {
      const response = await fetch("/api/checklist-import", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "File tidak dapat diproses.");
      if (commit) {
        setFinished(true);
        router.push(`/master/templates/${encodeURIComponent(result.templateId)}?${replacing ? "replaced" : "created"}=1`);
      } else {
        setPreview(result.preview);
        setRequestId(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "File tidak dapat diproses.");
    } finally {
      setPending(undefined);
    }
  }

  const invalid = preview?.rows.filter((row) => row.error) ?? [];

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-4">
      <input type="hidden" name="templateId" value={templateId} />
      <fieldset disabled={Boolean(pending) || finished} className="grid gap-4">
        {!replacing && divisions.length === 1 ? (
          <p className="text-sm text-[var(--muted)]">Divisi <strong className="text-[var(--fg)]">{divisions[0].name}</strong></p>
        ) : null}
        {!replacing && divisions.length > 1 ? (
          <label className="grid gap-1.5 text-sm font-medium">
            Divisi
            <select name="divisionId" required value={divisionId} onChange={(event) => {
              setDivisionId(event.target.value);
              resetPreview();
            }} className={field}>
              <option value="">Pilih divisi…</option>
              {divisions.map((division) => <option key={division.id} value={division.id}>{division.name}</option>)}
            </select>
          </label>
        ) : <input type="hidden" name="divisionId" value={divisionId} />}
        <label className="grid gap-1.5 text-sm font-medium">
          File Excel
          <input name="file" type="file" accept=".xlsx" required className={field} onChange={(event) => {
            const file = event.target.files?.[0];
            if (!replacing && file && !name) setName(file.name.replace(/\.xlsx$/i, "").slice(0, 100));
            resetPreview();
          }} />
        </label>
        {!replacing ? (
          <label className="grid gap-1.5 text-sm font-medium">
            Nama template
            <input name="templateName" required minLength={3} maxLength={100} value={name} onChange={(event) => {
              setName(event.target.value);
              resetPreview();
            }} className={field} />
          </label>
        ) : null}
      </fieldset>

      {preview ? (
        <section className="rounded-xl border border-[var(--border)] p-3 sm:p-4" aria-label="Pratinjau Excel">
          <h2 className="section-title">{invalid.length ? "Periksa kembali file" : "Pratinjau checklist"}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {preview.total} poin siap disimpan{preview.samples ? ` · ${preview.samples} baris contoh dilewati` : ""}
          </p>
          {replacing ? <p className="mt-2 text-sm font-medium">
            {preview.added} ditambah · {preview.changed} diubah · {preview.removed} dihapus · {preview.unchanged} tetap
          </p> : null}
          {invalid.length ? (
            <ul role="alert" className="mt-3 max-h-64 space-y-1.5 overflow-y-auto text-sm text-red-700 dark:text-red-300">
              {invalid.map((row) => <li key={row.number}>Baris {row.number}{row.label ? ` · ${row.label}` : ""} — {row.error}</li>)}
            </ul>
          ) : (
            <ul className="mt-3 max-h-64 divide-y divide-[var(--border)] overflow-y-auto text-sm">
              {preview.rows.map((row) => <li key={row.number} className="py-2">
                <div className="break-words font-medium">{row.label}</div>
                <p className="text-xs text-[var(--muted)]">{phaseLabel[row.phase as (typeof PHASES)[number]]} · {row.category}</p>
              </li>)}
            </ul>
          )}
        </section>
      ) : null}
      {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" value="preview" disabled={Boolean(pending) || finished} className={preview ? "btn-secondary" : "btn-primary"}>
          {pending === "preview" ? "Memeriksa…" : "Pratinjau Excel"}
        </button>
        {preview && !invalid.length ? <button type="submit" value="commit" disabled={Boolean(pending) || finished} className="btn-primary">
          {pending === "commit" || finished ? "Menyimpan…" : replacing ? "Ganti isi template" : "Buat template"}
        </button> : null}
      </div>
    </form>
  );
}
