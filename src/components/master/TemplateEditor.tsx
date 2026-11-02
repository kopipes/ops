"use client";

import { useActionState, useMemo, useState } from "react";
import type { ActionState } from "@/app/master-actions";
import { PHASES, phaseLabel } from "@/lib/schemas";
import { Badge } from "./MasterNav";

export interface MasterItemOption {
  id: string;
  label: string;
  phase: "opening" | "monitoring" | "closing";
  categoryName: string;
  isRequired: boolean;
  requiresPhoto: boolean;
  divisionName: string | null;
}

export interface SelectedItem {
  checklistItemId: string;
  isRequiredOverride: "inherit" | "true" | "false";
  requiresPhotoOverride: "inherit" | "true" | "false";
}

interface Props {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  availableItems: MasterItemOption[];
  divisions: { id: string; name: string }[];
  isAdmin: boolean;
  managerDivisionId: string | null;
  initial?: {
    id: string;
    name: string;
    description: string;
    divisionId: string;
    items: SelectedItem[];
  };
  submitLabel: string;
}

const inputCls = "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
const inputStyle = {
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--fg)",
} as const;

export function TemplateEditor({
  action,
  availableItems,
  divisions,
  isAdmin,
  managerDivisionId,
  initial,
  submitLabel,
}: Props) {
  const [state, formAction, pending] = useActionState(action, {} as ActionState);
  const [selected, setSelected] = useState<SelectedItem[]>(initial?.items ?? []);
  const [search, setSearch] = useState("");
  const [phaseTab, setPhaseTab] = useState<(typeof PHASES)[number]>("opening");

  const selectedIds = useMemo(() => new Set(selected.map((s) => s.checklistItemId)), [selected]);

  const pool = availableItems.filter((i) => {
    if (selectedIds.has(i.id)) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return i.label.toLowerCase().includes(q) || i.categoryName.toLowerCase().includes(q);
    }
    return i.phase === phaseTab;
  });

  const byId = useMemo(() => new Map(availableItems.map((i) => [i.id, i])), [availableItems]);

  const add = (id: string) => {
    setSelected((prev) => [
      ...prev,
      { checklistItemId: id, isRequiredOverride: "inherit", requiresPhotoOverride: "inherit" },
    ]);
  };

  const remove = (id: string) => {
    setSelected((prev) => prev.filter((s) => s.checklistItemId !== id));
  };

  const move = (index: number, dir: -1 | 1) => {
    setSelected((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const setOverride = (
    id: string,
    field: "isRequiredOverride" | "requiresPhotoOverride",
    value: "inherit" | "true" | "false",
  ) => {
    setSelected((prev) => prev.map((s) => (s.checklistItemId === id ? { ...s, [field]: value } : s)));
  };

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      {/* The action reads selected items in order from this repeated field. */}
      {selected.map((s) => (
        <div key={s.checklistItemId}>
          <input type="hidden" name="itemIds" value={s.checklistItemId} />
          <input type="hidden" name={`req_${s.checklistItemId}`} value={s.isRequiredOverride} />
          <input
            type="hidden"
            name={`photo_${s.checklistItemId}`}
            value={s.requiresPhotoOverride}
          />
        </div>
      ))}

      <div className="flex flex-col gap-1">
        <label htmlFor="name" className="text-sm" style={{ color: "var(--muted)" }}>
          Nama template
        </label>
        <input
          id="name"
          name="name"
          required
          minLength={3}
          defaultValue={initial?.name ?? ""}
          className={inputCls}
          style={inputStyle}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm" style={{ color: "var(--muted)" }}>
          Deskripsi (opsional)
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ""}
          className="w-full rounded-lg border px-3 py-2 text-base outline-none"
          style={inputStyle}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="divisionId" className="text-sm" style={{ color: "var(--muted)" }}>
          Divisi
        </label>
        {isAdmin ? (
          <select
            id="divisionId"
            name="divisionId"
            defaultValue={initial?.divisionId ?? ""}
            className={inputCls}
            style={inputStyle}
          >
            <option value="">Global (semua divisi)</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="hidden" name="divisionId" value={managerDivisionId ?? ""} />
            <p className="rounded-lg border px-3 py-2 text-sm" style={inputStyle}>
              {divisions.find((d) => d.id === managerDivisionId)?.name ?? managerDivisionId ?? "—"}
            </p>
          </>
        )}
      </div>

      <section aria-labelledby="selected-heading">
        <h2 id="selected-heading" className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
          Item terpilih ({selected.length})
        </h2>

        {selected.length === 0 ? (
          <p
            className="rounded-lg border px-3 py-4 text-center text-sm"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            Belum ada item. Tambahkan dari daftar di bawah.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {selected.map((s, index) => {
              const item = byId.get(s.checklistItemId);
              return (
                <li
                  key={s.checklistItemId}
                  className="rounded-lg border px-3 py-2"
                  style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item?.label ?? s.checklistItemId}</p>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        {item ? phaseLabel[item.phase] : ""} · {item?.categoryName ?? ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        aria-label={`Naikkan ${item?.label ?? "item"}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md border disabled:opacity-30"
                        style={{ borderColor: "var(--border)" }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={index === selected.length - 1}
                        aria-label={`Turunkan ${item?.label ?? "item"}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md border disabled:opacity-30"
                        style={{ borderColor: "var(--border)" }}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(s.checklistItemId)}
                        aria-label={`Hapus ${item?.label ?? "item"}`}
                        className="flex h-9 w-9 items-center justify-center rounded-md border"
                        style={{ borderColor: "var(--border)", color: "#dc2626" }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
                      Wajib
                      <select
                        value={s.isRequiredOverride}
                        onChange={(e) =>
                          setOverride(
                            s.checklistItemId,
                            "isRequiredOverride",
                            e.target.value as "inherit" | "true" | "false",
                          )
                        }
                        className="min-h-[36px] rounded-md border px-2 text-sm"
                        style={inputStyle}
                      >
                        <option value="inherit">
                          Ikuti master ({item?.isRequired ? "wajib" : "opsional"})
                        </option>
                        <option value="true">Wajib</option>
                        <option value="false">Opsional</option>
                      </select>
                    </label>

                    <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
                      Foto
                      <select
                        value={s.requiresPhotoOverride}
                        onChange={(e) =>
                          setOverride(
                            s.checklistItemId,
                            "requiresPhotoOverride",
                            e.target.value as "inherit" | "true" | "false",
                          )
                        }
                        className="min-h-[36px] rounded-md border px-2 text-sm"
                        style={inputStyle}
                      >
                        <option value="inherit">Ikuti master ({item?.requiresPhoto ? "ya" : "tidak"})</option>
                        <option value="true">Wajib foto</option>
                        <option value="false">Tanpa foto</option>
                      </select>
                    </label>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="pool-heading">
        <h2 id="pool-heading" className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
          Tambah dari master
        </h2>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari item…"
          aria-label="Cari item master"
          className={`${inputCls} mb-2`}
          style={inputStyle}
        />

        {!search.trim() ? (
          <div className="mb-2 flex gap-1">
            {PHASES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPhaseTab(p)}
                aria-pressed={phaseTab === p}
                className="min-h-[34px] flex-1 rounded-full px-2 text-xs"
                style={{
                  background: phaseTab === p ? "var(--accent)" : "var(--surface)",
                  color: phaseTab === p ? "#fff" : "var(--muted)",
                  border: "1px solid var(--border)",
                }}
              >
                {phaseLabel[p]}
              </button>
            ))}
          </div>
        ) : null}

        {pool.length === 0 ? (
          <p className="rounded-lg border px-3 py-4 text-center text-sm" style={{ borderColor: "var(--border)", color: "var(--muted)" }}>
            Tidak ada item yang cocok.
          </p>
        ) : (
          <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
            {pool.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  onClick={() => add(i.id)}
                  className="flex w-full min-h-[44px] items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm"
                  style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{i.label}</span>
                    <span className="block text-xs" style={{ color: "var(--muted)" }}>
                      {i.categoryName}
                      {i.divisionName ? ` · ${i.divisionName}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-lg" style={{ color: "var(--accent)" }} aria-hidden="true">
                    +
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {state.error ? (
        <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
          {state.error}
        </p>
      ) : null}
      {state.ok ? <Badge tone="ok">Tersimpan</Badge> : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent)" }}
      >
        {pending ? "Menyimpan…" : submitLabel}
      </button>
    </form>
  );
}
