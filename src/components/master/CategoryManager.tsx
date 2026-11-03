"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/app/master-actions";
import { Badge } from "./MasterNav";

export interface CategoryRowView {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface Props {
  title: string;
  rows: CategoryRowView[];
  saveAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  deactivateAction: (formData: FormData) => Promise<void>;
  /** Checklist categories also manage reactivation via the same save action. */
  withMasterNav?: boolean;
}

const inputCls = "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
const inputStyle = {
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--fg)",
} as const;

export function CategoryManager({ title, rows, saveAction, deactivateAction }: Props) {
  const [state, formAction, pending] = useActionState(saveAction, {} as ActionState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const editing = rows.find((r) => r.id === editingId);
  const visible = showInactive ? rows : rows.filter((r) => r.isActive);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{title}</h1>

      <form
        action={formAction}
        className="flex flex-col gap-3 rounded-xl border p-4"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

        <h2 className="text-base font-medium">{editing ? `Edit: ${editing.name}` : "Kategori baru"}</h2>

        <div className="flex flex-col gap-1">
          <label htmlFor="cat-name" className="text-sm" style={{ color: "var(--muted)" }}>
            Nama
          </label>
          <input
            id="cat-name"
            name="name"
            required
            minLength={2}
            defaultValue={editing?.name ?? ""}
            key={editing?.id ?? "new"}
            className={inputCls}
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="cat-order" className="text-sm" style={{ color: "var(--muted)" }}>
            Urutan
          </label>
          <input
            id="cat-order"
            name="sortOrder"
            type="number"
            min={0}
            inputMode="numeric"
            defaultValue={editing?.sortOrder ?? 0}
            key={`o-${editing?.id ?? "new"}`}
            className={inputCls}
            style={inputStyle}
          />
        </div>

        {state.error ? (
          <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
            {state.error}
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="min-h-tap flex-1 rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
            style={{ background: "var(--accent)" }}
          >
            {pending ? "Menyimpan…" : editing ? "Simpan perubahan" : "Tambah kategori"}
          </button>
          {editing ? (
            <button
              type="button"
              onClick={() => setEditingId(null)}
              className="min-h-tap rounded-lg border px-4 py-3 text-sm"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              Batal
            </button>
          ) : null}
        </div>
      </form>

      <label className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="h-4 w-4"
        />
        Tampilkan yang nonaktif
      </label>

      {visible.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Belum ada kategori.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3">
          {visible.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-xl border px-4 py-3"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface)",
                opacity: r.isActive ? 1 : 0.6,
              }}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{r.name}</p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  urutan {r.sortOrder}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {!r.isActive ? <Badge>Nonaktif</Badge> : null}
                <button
                  type="button"
                  onClick={() => setEditingId(r.id)}
                  className="min-h-[36px] rounded-lg border px-3 text-sm"
                  style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                >
                  Edit
                </button>
                {r.isActive ? (
                  <form action={deactivateAction}>
                    <input type="hidden" name="id" value={r.id} />
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
