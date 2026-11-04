"use client";

import { useActionState, useEffect, useState } from "react";
import type { ActionState } from "@/app/master-actions";
import { PHASES, phaseLabel } from "@/lib/schemas";

export interface ItemFormValues {
  id?: string;
  label: string;
  description: string;
  phase: "opening" | "monitoring" | "closing";
  categoryId: string;
  divisionId: string;
  isRequired: boolean;
  requiresPhoto: boolean;
  sortOrder: number;
  isActive: boolean;
}

export function ItemForm({
  action,
  categories,
  divisions,
  lockedDivision,
  initial,
  onDone,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  categories: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
  /** Managers may only pick their own division (§2.3). */
  lockedDivision?: string | null;
  initial?: Partial<ItemFormValues>;
  onDone?: () => void;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const [phase, setPhase] = useState<ItemFormValues["phase"]>(initial?.phase ?? "opening");

  // Close the panel once the save succeeds. Must run in an effect, not during
  // render, or React warns about setState on a component being rendered.
  useEffect(() => {
    if (state.ok && onDone) onDone();
  }, [state.ok, onDone]);

  const field =
    "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
  const fieldStyle = {
    background: "var(--surface)",
    borderColor: "var(--border)",
    color: "var(--fg)",
  } as const;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="label" className="text-sm" style={{ color: "var(--muted)" }}>
          Label item
        </label>
        <input
          id="label"
          name="label"
          required
          defaultValue={initial?.label ?? ""}
          placeholder="mis. Lampu panggung berfungsi"
          className={field}
          style={fieldStyle}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm" style={{ color: "var(--muted)" }}>
          Petunjuk (opsional)
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ""}
          className="w-full rounded-lg border px-3 py-2 text-base outline-none"
          style={fieldStyle}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="phase" className="text-sm" style={{ color: "var(--muted)" }}>
            Fase
          </label>
          <select
            id="phase"
            name="phase"
            value={phase}
            onChange={(e) => setPhase(e.target.value as ItemFormValues["phase"])}
            className={field}
            style={fieldStyle}
          >
            {PHASES.map((p) => (
              <option key={p} value={p}>
                {phaseLabel[p]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="categoryId" className="text-sm" style={{ color: "var(--muted)" }}>
            Kategori
          </label>
          <select
            id="categoryId"
            name="categoryId"
            required
            defaultValue={initial?.categoryId ?? categories[0]?.id ?? ""}
            className={field}
            style={fieldStyle}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="divisionId" className="text-sm" style={{ color: "var(--muted)" }}>
          Divisi
        </label>
        {lockedDivision !== undefined ? (
          <>
            <input type="hidden" name="divisionId" value={lockedDivision ?? ""} />
            <p
              className="rounded-lg border px-3 py-2 text-sm"
              style={fieldStyle}
              aria-label="Divisi terkunci"
            >
              {lockedDivision
                ? (divisions.find((d) => d.id === lockedDivision)?.name ?? lockedDivision)
                : "Global (semua divisi)"}
            </p>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Hanya Admin yang bisa memindahkan item antar divisi.
            </p>
          </>
        ) : (
          <select
            id="divisionId"
            name="divisionId"
            defaultValue={initial?.divisionId ?? ""}
            className={field}
            style={fieldStyle}
          >
            <option value="">Global (semua divisi)</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isRequired"
            defaultChecked={initial?.isRequired ?? true}
            className="h-5 w-5"
          />
          Wajib diisi
        </label>
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="requiresPhoto"
            defaultChecked={initial?.requiresPhoto ?? false}
            className="h-5 w-5"
          />
          Wajib foto
        </label>
        <label className="flex min-h-tap items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={initial?.isActive ?? true}
            className="h-5 w-5"
          />
          Aktif
        </label>
      </div>

      <input type="hidden" name="sortOrder" value={initial?.sortOrder ?? 0} />

      {state.error ? (
        <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent-solid)" }}
      >
        {pending ? "Menyimpan…" : initial?.id ? "Simpan perubahan" : "Tambah item"}
      </button>
    </form>
  );
}
