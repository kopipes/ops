"use client";

import { useActionState, useEffect, useState } from "react";
import type { AdminActionState } from "@/app/admin-actions";

export interface DivisionRowView {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  userCount: number;
}

const inputCls = "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
const inputStyle = {
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--fg)",
} as const;

export function DivisionManager({
  rows,
  saveAction,
  toggleAction,
}: {
  rows: DivisionRowView[];
  saveAction: (prev: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  toggleAction: (formData: FormData) => Promise<void>;
}) {
  const [state, formAction, pending] = useActionState(saveAction, {} as AdminActionState);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const editing = rows.find((r) => r.id === editingId);

  useEffect(() => {
    if (state.ok) {
      setCreating(false);
      setEditingId(null);
    }
  }, [state.ok]);

  const showForm = creating || Boolean(editing);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Divisi</h1>
        {!showForm ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="min-h-[40px] rounded-lg px-3 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            + Divisi
          </button>
        ) : null}
      </div>

      {showForm ? (
        <form
          action={formAction}
          className="flex flex-col gap-3 rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <h2 className="text-base font-medium">{editing ? `Edit ${editing.name}` : "Divisi baru"}</h2>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

          <label className="flex flex-col gap-1">
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              Kode (dipakai untuk kode project, mis. EVT)
            </span>
            <input
              name="code"
              required
              maxLength={10}
              defaultValue={editing?.code ?? ""}
              className={inputCls}
              style={inputStyle}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              Nama divisi
            </span>
            <input
              name="name"
              required
              defaultValue={editing?.name ?? ""}
              className={inputCls}
              style={inputStyle}
            />
          </label>

          <label className="flex min-h-[36px] items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="isActive"
              defaultChecked={editing?.isActive ?? true}
              className="h-4 w-4"
            />
            Aktif
          </label>

          {state.error ? (
            <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
              {state.error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="min-h-tap flex-1 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              style={{ background: "var(--accent)" }}
            >
              {pending ? "Menyimpan…" : editing ? "Simpan perubahan" : "Buat divisi"}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setEditingId(null);
              }}
              className="min-h-tap rounded-lg border px-4 py-2 text-sm"
              style={{ borderColor: "var(--border)", color: "var(--muted)" }}
            >
              Batal
            </button>
          </div>
        </form>
      ) : null}

      <ul className="flex flex-col gap-2">
        {rows.map((d) => (
          <li
            key={d.id}
            className="flex items-start justify-between gap-2 rounded-xl border px-4 py-3"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface)",
              opacity: d.isActive ? 1 : 0.6,
            }}
          >
            <div className="min-w-0">
              <p className="font-medium">
                {d.name} <span className="text-xs" style={{ color: "var(--muted)" }}>{d.code}</span>
              </p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {d.userCount} user
                {d.isActive ? "" : " · nonaktif"}
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditingId(d.id);
                }}
                className="min-h-[34px] rounded-md border px-3 text-xs"
                style={{ borderColor: "var(--border)", color: "var(--fg)" }}
              >
                Edit
              </button>
              <form action={toggleAction}>
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="isActive" value={d.isActive ? "0" : "1"} />
                <button
                  type="submit"
                  className="min-h-[34px] rounded-md border px-3 text-xs"
                  style={{ borderColor: "var(--border)", color: d.isActive ? "#dc2626" : "#166534" }}
                >
                  {d.isActive ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Divisi tidak bisa dihapus permanen — hanya dinonaktifkan, karena user dan project merujuknya.
      </p>
    </div>
  );
}
