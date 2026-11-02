"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/master-actions";
import { Badge } from "./MasterNav";

export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  divisionName: string | null;
  isActive: boolean;
  itemCount: number;
  phases: { opening: number; monitoring: number; closing: number };
}

interface Props {
  templates: TemplateRow[];
  projects: { id: string; name: string; code: string }[];
  duplicateAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fromProjectAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  deactivateAction: (formData: FormData) => Promise<void>;
}

const inputCls = "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
const inputStyle = {
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--fg)",
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export function TemplateList({
  templates,
  projects,
  duplicateAction,
  fromProjectAction,
  deactivateAction,
}: Props) {
  const [mode, setMode] = useState<"none" | "from-project" | "duplicate">("none");
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const [projState, projFormAction, projPending] = useActionState(fromProjectAction, {} as ActionState);
  const [dupState, dupFormAction, dupPending] = useActionState(duplicateAction, {} as ActionState);

  const duplicateSource = templates.find((t) => t.id === duplicateId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Template Checklist</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href="/master/templates/new"
          className="min-h-[40px] rounded-lg px-3 text-sm font-medium leading-[40px] text-white"
          style={{ background: "var(--accent)" }}
        >
          + Template baru
        </a>
        <button
          type="button"
          onClick={() => setMode(mode === "from-project" ? "none" : "from-project")}
          aria-expanded={mode === "from-project"}
          className="min-h-[40px] rounded-lg border px-3 text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--fg)" }}
        >
          Dari project lama
        </button>
      </div>

      {mode === "from-project" ? (
        <form
          action={projFormAction}
          className="flex flex-col gap-3 rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <h2 className="text-base font-medium">Simpan checklist project sebagai template</h2>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Item custom pada project akan otomatis dibuatkan sebagai master item baru, ditandai dengan
            project asal (§5.2).
          </p>

          <Field label="Project">
            <select name="projectId" required className={inputCls} style={inputStyle} defaultValue="">
              <option value="" disabled>
                Pilih project…
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Nama template">
            <input name="name" required minLength={3} className={inputCls} style={inputStyle} />
          </Field>

          {projState.error ? (
            <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
              {projState.error}
            </p>
          ) : null}
          {projState.ok ? (
            <p className="text-sm" style={{ color: "#166534" }}>
              Template berhasil dibuat.
            </p>
          ) : null}

          <button
            type="submit"
            disabled={projPending}
            className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {projPending ? "Membuat…" : "Buat template"}
          </button>
        </form>
      ) : null}

      {mode === "duplicate" && duplicateSource ? (
        <form
          action={dupFormAction}
          className="flex flex-col gap-3 rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <h2 className="text-base font-medium">Duplikat “{duplicateSource.name}”</h2>
          <input type="hidden" name="sourceId" value={duplicateSource.id} />
          <Field label="Nama template baru">
            <input
              name="name"
              required
              minLength={3}
              defaultValue={`${duplicateSource.name} (copy)`}
              className={inputCls}
              style={inputStyle}
            />
          </Field>

          {dupState.error ? (
            <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
              {dupState.error}
            </p>
          ) : null}
          {dupState.ok ? (
            <p className="text-sm" style={{ color: "#166534" }}>
              Template berhasil diduplikasi.
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={dupPending}
              className="min-h-tap flex-1 rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
              style={{ background: "var(--accent)" }}
            >
              {dupPending ? "Menyalin…" : "Duplikat"}
            </button>
            <button
              type="button"
              onClick={() => setMode("none")}
              className="min-h-tap rounded-lg border px-4 py-3 text-sm"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              Batal
            </button>
          </div>
        </form>
      ) : null}

      {templates.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Belum ada template.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <li
              key={t.id}
              className="rounded-xl border px-4 py-3"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface)",
                opacity: t.isActive ? 1 : 0.6,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{t.name}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {t.divisionName ?? "Global"} · {t.itemCount} item
                  </p>
                </div>
                {!t.isActive ? <Badge>Nonaktif</Badge> : null}
              </div>

              {t.description ? (
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  {t.description}
                </p>
              ) : null}

              <div className="mt-2 flex flex-wrap gap-1">
                <Badge>O: {t.phases.opening}</Badge>
                <Badge>M: {t.phases.monitoring}</Badge>
                <Badge>C: {t.phases.closing}</Badge>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <a
                  href={`/master/templates/${t.id}`}
                  className="min-h-[36px] rounded-lg border px-3 text-sm leading-[36px]"
                  style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                >
                  Edit
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setDuplicateId(t.id);
                    setMode("duplicate");
                  }}
                  className="min-h-[36px] rounded-lg border px-3 text-sm"
                  style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                >
                  Duplikat
                </button>
                {t.isActive ? (
                  <form action={deactivateAction}>
                    <input type="hidden" name="id" value={t.id} />
                    <button
                      type="submit"
                      className="min-h-[36px] rounded-lg border px-3 text-sm"
                      style={{ borderColor: "var(--border)", color: "#dc2626" }}
                    >
                      Nonaktifkan
                    </button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
