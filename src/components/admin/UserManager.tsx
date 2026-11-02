"use client";

import { useActionState, useEffect, useState } from "react";
import type { AdminActionState } from "@/app/admin-actions";

export interface UserRowView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "admin" | "corporate" | "manager" | "user";
  primaryDivisionId: string | null;
  primaryDivisionName: string | null;
  divisionIds: string[];
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: number | null;
}

const ROLES = [
  { value: "admin", label: "Admin" },
  { value: "corporate", label: "Corporate" },
  { value: "manager", label: "Manager" },
  { value: "user", label: "User (Crew)" },
] as const;

const inputCls = "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
const inputStyle = {
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--fg)",
} as const;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

export function UserManager({
  rows,
  divisions,
  saveAction,
  resetAction,
  toggleAction,
  currentUserId,
}: {
  rows: UserRowView[];
  divisions: { id: string; name: string }[];
  saveAction: (prev: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  resetAction: (prev: AdminActionState, formData: FormData) => Promise<AdminActionState>;
  toggleAction: (formData: FormData) => Promise<void>;
  currentUserId: string;
}) {
  const [state, formAction, pending] = useActionState(saveAction, {} as AdminActionState);
  const [resetState, resetFormAction, resetPending] = useActionState(
    resetAction,
    {} as AdminActionState,
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const editing = rows.find((r) => r.id === editingId);

  // Close the editor once a save succeeds.
  useEffect(() => {
    if (state.ok) {
      setCreating(false);
      setEditingId(null);
    }
  }, [state.ok]);

  const visible = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
  });

  const showForm = creating || Boolean(editing);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">User</h1>
        {!showForm ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="min-h-[40px] rounded-lg px-3 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            + User
          </button>
        ) : null}
      </div>

      {showForm ? (
        <form
          action={formAction}
          className="flex flex-col gap-3 rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <h2 className="text-base font-medium">{editing ? `Edit ${editing.name}` : "User baru"}</h2>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}

          <Field label="Nama">
            <input
              name="name"
              required
              defaultValue={editing?.name ?? ""}
              className={inputCls}
              style={inputStyle}
            />
          </Field>

          <Field label="Email">
            <input
              name="email"
              type="email"
              required
              defaultValue={editing?.email ?? ""}
              className={inputCls}
              style={inputStyle}
            />
          </Field>

          <Field label="Telepon (opsional)">
            <input
              name="phone"
              defaultValue={editing?.phone ?? ""}
              className={inputCls}
              style={inputStyle}
            />
          </Field>

          <Field label="Role">
            <select
              name="role"
              defaultValue={editing?.role ?? "user"}
              className={inputCls}
              style={inputStyle}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Divisi utama">
            <select
              name="primaryDivisionId"
              required
              defaultValue={editing?.primaryDivisionId ?? divisions[0]?.id ?? ""}
              className={inputCls}
              style={inputStyle}
            >
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>

          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm" style={{ color: "var(--muted)" }}>
              Divisi tambahan (opsional)
            </legend>
            {divisions
              .filter((d) => d.id !== (editing?.primaryDivisionId ?? divisions[0]?.id))
              .map((d) => (
                <label key={d.id} className="flex min-h-[36px] items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="additionalDivisionIds"
                    value={d.id}
                    defaultChecked={editing?.divisionIds.includes(d.id) ?? false}
                    className="h-4 w-4"
                  />
                  {d.name}
                </label>
              ))}
          </fieldset>

          {!editing ? (
            <Field label="Password awal (min. 8 karakter)">
              <input
                name="password"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                className={inputCls}
                style={inputStyle}
              />
            </Field>
          ) : null}

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
              {pending ? "Menyimpan…" : editing ? "Simpan perubahan" : "Buat user"}
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

      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Cari nama atau email…"
        aria-label="Cari user"
        className={inputCls}
        style={inputStyle}
      />

      <ul className="flex flex-col gap-2">
        {visible.map((u) => (
          <li
            key={u.id}
            className="rounded-xl border px-4 py-3"
            style={{
              borderColor: "var(--border)",
              background: "var(--surface)",
              opacity: u.isActive ? 1 : 0.6,
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {u.name}
                  {u.id === currentUserId ? (
                    <span className="text-xs" style={{ color: "var(--muted)" }}>
                      {" "}
                      (kamu)
                    </span>
                  ) : null}
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {u.email}
                  {u.phone ? ` · ${u.phone}` : ""}
                </p>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {u.role} · {u.primaryDivisionName ?? "—"}
                  {u.divisionIds.length > 1 ? ` +${u.divisionIds.length - 1} divisi` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {!u.isActive ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px]"
                    style={{ background: "#e2e8f0", color: "#334155" }}
                  >
                    Nonaktif
                  </span>
                ) : null}
                {u.mustChangePassword ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px]"
                    style={{ background: "#ffedd5", color: "#9a3412" }}
                  >
                    Ganti password
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setEditingId(u.id);
                }}
                className="min-h-[34px] rounded-md border px-3 text-xs"
                style={{ borderColor: "var(--border)", color: "var(--fg)" }}
              >
                Edit
              </button>

              <button
                type="button"
                onClick={() => setResettingId(resettingId === u.id ? null : u.id)}
                className="min-h-[34px] rounded-md border px-3 text-xs"
                style={{ borderColor: "var(--border)", color: "var(--fg)" }}
              >
                Reset password
              </button>

              {u.id !== currentUserId ? (
                <form action={toggleAction}>
                  <input type="hidden" name="id" value={u.id} />
                  <input type="hidden" name="isActive" value={u.isActive ? "0" : "1"} />
                  <button
                    type="submit"
                    className="min-h-[34px] rounded-md border px-3 text-xs"
                    style={{ borderColor: "var(--border)", color: u.isActive ? "#dc2626" : "#166534" }}
                  >
                    {u.isActive ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </form>
              ) : null}
            </div>

            {resettingId === u.id ? (
              <form action={resetFormAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="id" value={u.id} />
                <input
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  placeholder="Password sementara (min. 8 karakter)"
                  aria-label={`Password baru untuk ${u.name}`}
                  className={inputCls}
                  style={inputStyle}
                />
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  User wajib mengganti password saat login berikutnya; semua sesinya langsung berakhir.
                </p>
                {resetState.error ? (
                  <p role="alert" className="text-xs" style={{ color: "#dc2626" }}>
                    {resetState.error}
                  </p>
                ) : null}
                {resetState.ok ? (
                  <p className="text-xs" style={{ color: "#166534" }}>
                    Password direset.
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={resetPending}
                  className="min-h-tap rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                  style={{ background: "var(--accent)" }}
                >
                  {resetPending ? "Menyimpan…" : "Simpan password"}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      {visible.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Tidak ada user yang cocok.
        </p>
      ) : null}
    </div>
  );
}
