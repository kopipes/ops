"use client";

import { useState } from "react";
import { ItemForm, type ItemFormValues } from "./ItemForm";
import { Badge } from "./MasterNav";
import type { ActionState } from "@/app/master-actions";

export interface ItemRow extends ItemFormValues {
  categoryName: string;
  divisionName: string | null;
  isUsed: boolean;
}

interface Props {
  items: ItemRow[];
  categories: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
  /** Admin picks any division; managers are locked to their own. */
  isAdmin: boolean;
  managerDivisionId: string | null;
  saveAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  deactivateAction: (formData: FormData) => Promise<void>;
  reactivateAction: (formData: FormData) => Promise<void>;
}

const TABS = [
  { key: "all", label: "Semua" },
  { key: "opening", label: "Opening" },
  { key: "monitoring", label: "Monitoring" },
  { key: "closing", label: "Closing" },
] as const;

export function ChecklistItemList({
  items,
  categories,
  divisions,
  isAdmin,
  managerDivisionId,
  saveAction,
  deactivateAction,
  reactivateAction,
}: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const visible = items
    .filter((i) => (tab === "all" ? true : i.phase === tab))
    .filter((i) => (showInactive ? true : i.isActive));

  const editing = items.find((i) => i.id === editingId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Master Checklist</h1>
        {!creating && !editing ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="min-h-[40px] rounded-lg px-3 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            + Item
          </button>
        ) : null}
      </div>

      {creating ? (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <h2 className="mb-3 text-base font-medium">Item baru</h2>
          <ItemForm
            action={saveAction}
            categories={categories}
            divisions={divisions}
            lockedDivision={isAdmin ? undefined : managerDivisionId}
            onDone={() => setCreating(false)}
          />
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="mt-2 min-h-tap w-full rounded-lg border px-4 py-2 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            Batal
          </button>
        </div>
      ) : null}

      {editing ? (
        <div
          className="rounded-xl border p-4"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <h2 className="mb-3 text-base font-medium">Edit item</h2>
          <ItemForm
            action={saveAction}
            categories={categories}
            divisions={divisions}
            lockedDivision={isAdmin ? undefined : managerDivisionId}
            initial={editing}
            onDone={() => setEditingId(null)}
          />
          <button
            type="button"
            onClick={() => setEditingId(null)}
            className="mt-2 min-h-tap w-full rounded-lg border px-4 py-2 text-sm"
            style={{ borderColor: "var(--border)", color: "var(--muted)" }}
          >
            Batal
          </button>
        </div>
      ) : null}

      <div className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-pressed={tab === t.key}
            className="min-h-[36px] whitespace-nowrap rounded-full px-3 text-sm"
            style={{
              background: tab === t.key ? "var(--accent)" : "var(--surface)",
              color: tab === t.key ? "#fff" : "var(--muted)",
              border: "1px solid var(--border)",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
        <input
          type="checkbox"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
          className="h-4 w-4"
        />
        Tampilkan item nonaktif
      </label>

      {visible.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          Belum ada item pada fase ini.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border px-4 py-3"
              style={{
                borderColor: "var(--border)",
                background: "var(--surface)",
                opacity: item.isActive ? 1 : 0.6,
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{item.label}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    {item.categoryName} · {item.divisionName ?? "Global"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {item.isRequired ? <Badge tone="warn">Wajib</Badge> : null}
                  {item.requiresPhoto ? <Badge>Foto</Badge> : null}
                  {!item.isActive ? <Badge>Nonaktif</Badge> : null}
                  {item.isUsed ? <Badge tone="ok">Terpakai</Badge> : null}
                </div>
              </div>

              {item.description ? (
                <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                  {item.description}
                </p>
              ) : null}

              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setEditingId(item.id ?? null);
                  }}
                  className="min-h-[36px] rounded-lg border px-3 text-sm"
                  style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                >
                  Edit
                </button>

                <form action={item.isActive ? deactivateAction : reactivateAction}>
                  <input type="hidden" name="id" value={item.id} />
                  <button
                    type="submit"
                    className="min-h-[36px] rounded-lg border px-3 text-sm"
                    style={{
                      borderColor: "var(--border)",
                      color: item.isActive ? "#dc2626" : "#166534",
                    }}
                  >
                    {item.isActive ? "Nonaktifkan" : "Aktifkan"}
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Item tidak pernah dihapus permanen — hanya dinonaktifkan (§5.1). Menonaktifkan item tidak
        mengubah checklist project yang sudah ada.
      </p>
    </div>
  );
}
