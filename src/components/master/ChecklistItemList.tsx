"use client";

import { Fragment, useMemo, useState } from "react";
import { RemoveDataButton, useDataRemoval } from "@/components/admin/DataRemoval";
import { ItemForm, type ItemFormValues } from "./ItemForm";
import { Badge } from "./MasterNav";
import { phaseLabel } from "@/lib/schemas";
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

const inputCls = "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
const inputStyle = {
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--fg)",
} as const;

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
  const [search, setSearch] = useState("");
  const { requestRemoval, removalNotice, removalDialog } = useDataRemoval();

  const query = search.trim().toLowerCase();

  const visible = useMemo(
    () =>
      items
        .filter((i) => (tab === "all" ? true : i.phase === tab))
        .filter((i) => (showInactive ? true : i.isActive))
        .filter((i) => {
          // Search across the fields an admin actually scans by: the label,
          // the free-text description, and the category/division grouping.
          if (!query) return true;
          return (
            i.label.toLowerCase().includes(query) ||
            i.description.toLowerCase().includes(query) ||
            i.categoryName.toLowerCase().includes(query) ||
            (i.divisionName ?? "global").toLowerCase().includes(query)
          );
        }),
    [items, tab, showInactive, query],
  );

  const editing = items.find((i) => i.id === editingId);

  // The server orders by phase (alphabetically) then sortOrder, so "Semua" reads
  // Closing → Monitoring → Opening. Surface that grouping explicitly instead of
  // leaving the order looking arbitrary: split the rows into contiguous phase
  // blocks and label each one.
  const groupedByPhase = useMemo(() => {
    if (tab !== "all") return null;
    const groups: { phase: ItemRow["phase"]; rows: ItemRow[] }[] = [];
    for (const row of visible) {
      const last = groups.at(-1);
      if (last && last.phase === row.phase) last.rows.push(row);
      else groups.push({ phase: row.phase, rows: [row] });
    }
    return groups;
  }, [tab, visible]);

  // One desktop row. Shared by the flat and phase-grouped renderings.
  const renderRow = (item: ItemRow) => (
      <tr
        className="border-t align-top"
        style={{ borderColor: "var(--border)", opacity: item.isActive ? 1 : 0.6 }}
      >
        <td className="px-3 py-1.5">
          <p className="font-medium">{item.label}</p>
          {item.description ? (
            <p className="max-w-[46ch] text-xs" style={{ color: "var(--muted)" }}>
              {item.description}
            </p>
          ) : null}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-xs" style={{ color: "var(--muted)" }}>
          {item.categoryName}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-xs" style={{ color: "var(--muted)" }}>
          {item.divisionName ?? "Global"}
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-xs" style={{ color: "var(--muted)" }}>
          {phaseLabel[item.phase]}
        </td>
        <td className="px-3 py-1.5">
          <div className="flex flex-wrap gap-1">
            {item.isRequired ? <Badge tone="warn">Wajib</Badge> : null}
            {item.requiresPhoto ? <Badge>Foto</Badge> : null}
            {!item.isActive ? <Badge>Nonaktif</Badge> : null}
            {item.isUsed ? <Badge tone="ok">Terpakai</Badge> : null}
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-1.5 text-xs" style={{ color: "var(--muted)" }}>
          {item.sortOrder}
        </td>
        <td className="px-3 py-1.5">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setEditingId(item.id ?? null);
              }}
              className="min-h-[32px] rounded-lg border px-3 text-xs"
              style={{ borderColor: "var(--border)", color: "var(--fg)" }}
            >
              Edit
            </button>

            <form action={item.isActive ? deactivateAction : reactivateAction}>
              <input type="hidden" name="id" value={item.id} />
              <button
                type="submit"
                className="min-h-[32px] rounded-lg border px-3 text-xs"
                style={{
                  borderColor: "var(--border)",
                  color: item.isActive ? "#dc2626" : "#166534",
                }}
              >
                {item.isActive ? "Nonaktifkan" : "Aktifkan"}
              </button>
            </form>
            {isAdmin && item.id ? <RemoveDataButton onClick={() => requestRemoval("checklist_item", item.id!)} /> : null}
          </div>
        </td>
      </tr>
    );

  return (
    <div className="flex flex-col gap-4">
      {removalNotice}
      {removalDialog}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Master Checklist</h1>
        {!creating && !editing ? (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="min-h-[40px] rounded-lg px-3 text-sm font-medium text-white"
            style={{ background: "var(--accent-solid)" }}
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

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-pressed={tab === t.key}
              className="min-h-[36px] whitespace-nowrap rounded-full px-3 text-sm"
              style={{
                background: tab === t.key ? "var(--accent-solid)" : "var(--surface)",
                color: tab === t.key ? "#fff" : "var(--muted)",
                border: "1px solid var(--border)",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari item, kategori, atau divisi…"
          aria-label="Cari item checklist"
          className={`${inputCls} lg:max-w-xs`}
          style={inputStyle}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4"
          />
          Tampilkan item nonaktif
        </label>

        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {visible.length} item
          {query ? ` cocok dengan “${search.trim()}”` : ""}
        </p>
      </div>

      {visible.length === 0 ? (
        <p
          className="rounded-xl border px-4 py-6 text-center text-sm"
          style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--muted)" }}
        >
          {query
            ? "Tidak ada item yang cocok dengan pencarian."
            : "Belum ada item pada fase ini."}
        </p>
      ) : (
        <>
          {/* Desktop: a dense row list. Scanning a long checklist is a
              read-across task, so each item is one row with aligned columns
              instead of a two-column card grid. */}
          <div
            className="hidden overflow-x-auto rounded-xl border lg:block"
            style={{ borderColor: "var(--border)" }}
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr style={{ background: "var(--surface)" }}>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--muted)" }}>
                    Item
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--muted)" }}>
                    Kategori
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--muted)" }}>
                    Divisi
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--muted)" }}>
                    Fase
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--muted)" }}>
                    Atribut
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-medium" style={{ color: "var(--muted)" }}>
                    Urutan
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-xs font-medium" style={{ color: "var(--muted)" }}>
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupedByPhase
                  ? groupedByPhase.map((g) => (
                      <Fragment key={g.phase}>
                        <tr className="border-t">
                          <th
                            scope="colgroup"
                            colSpan={7}
                            className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide"
                            style={{ background: "var(--surface)", color: "var(--muted)" }}
                          >
                            {phaseLabel[g.phase]} · {g.rows.length} item
                          </th>
                        </tr>
                        {g.rows.map((item) => (
                          <Fragment key={item.id}>{renderRow(item)}</Fragment>
                        ))}
                      </Fragment>
                    ))
                  : visible.map((item) => <Fragment key={item.id}>{renderRow(item)}</Fragment>)}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards, unchanged. */}
          <ul className="flex flex-col gap-2 lg:hidden">
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
                  {isAdmin && item.id ? <RemoveDataButton onClick={() => requestRemoval("checklist_item", item.id!)} /> : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Item yang belum digunakan dapat dihapus permanen. Item yang sudah digunakan akan diarsipkan. Menonaktifkan item tidak
        mengubah checklist project yang sudah ada.
      </p>
    </div>
  );
}
