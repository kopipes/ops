"use client";

import { useState } from "react";
import type { EditReportState } from "@/app/edit-actions";

export interface EditableResult {
  projectChecklistItemId: string;
  label: string;
  categoryName: string;
  result: "ok" | "not_ok" | "na";
  note: string | null;
  isRequired: boolean;
  requiresPhoto: boolean;
}

export function EditReportForm({
  action,
  reportId,
  notes,
  results,
}: {
  action: (prev: EditReportState, formData: FormData) => Promise<EditReportState>;
  reportId: string;
  notes: string | null;
  results: EditableResult[];
}) {
  const [state, setState] = useState<EditReportState>({});
  const [pending, setPending] = useState(false);
  const [answers, setAnswers] = useState<Record<string, { result: string; note: string }>>(() => {
    const init: Record<string, { result: string; note: string }> = {};
    for (const r of results) {
      init[r.projectChecklistItemId] = { result: r.result, note: r.note ?? "" };
    }
    return init;
  });

  const set = (id: string, patch: Partial<{ result: string; note: string }>) => {
    setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  /*
   * Call the action directly rather than through `useActionState`.
   * With `useActionState`, a client-side navigation into this page leaves the
   * action running without a request scope, so `cookies()` (via `requireUser`)
   * throws "cookies was called outside a request scope" and the save 500s.
   * Navigating on the client with `window.location` also mirrors the crew form.
   */
  const onSubmit = async (formData: FormData) => {
    setPending(true);
    setState({});
    let res: EditReportState;
    try {
      res = await action({}, formData);
    } catch {
      setPending(false);
      setState({ error: "Terjadi kesalahan. Coba lagi." });
      return;
    }
    setPending(false);
    if (res.error) {
      setState({ error: res.error });
      return;
    }
    window.location.href = `/reports/edit/${reportId}?saved=1`;
  };

  return (
    <form action={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="reportId" value={reportId} />
      {results.map((r) => (
        <div key={r.projectChecklistItemId}>
          <input type="hidden" name={`r_${r.projectChecklistItemId}`} value={answers[r.projectChecklistItemId]?.result ?? ""} />
          <input type="hidden" name={`note_${r.projectChecklistItemId}`} value={answers[r.projectChecklistItemId]?.note ?? ""} />
        </div>
      ))}

      <ul className="flex flex-col gap-2">
        {results.map((r) => {
          const a = answers[r.projectChecklistItemId];
          return (
            <li
              key={r.projectChecklistItemId}
              className="rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <p className="text-sm font-medium">{r.label}</p>
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {r.categoryName}
              </p>

              <div className="mt-2 grid grid-cols-3 gap-1">
                {(
                  [
                    ["ok", "OK"],
                    ["not_ok", "Tidak OK"],
                    ["na", "N/A"],
                  ] as const
                ).map(([value, label]) => {
                  const selected = a?.result === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => set(r.projectChecklistItemId, { result: value })}
                      className="min-h-tap rounded-lg border text-sm font-medium"
                      style={{
                        borderColor: selected ? "var(--accent)" : "var(--border)",
                        background: selected
                          ? value === "ok"
                            ? "#dcfce7"
                            : value === "not_ok"
                              ? "#fee2e2"
                              : "var(--border)"
                          : "transparent",
                        color: "var(--fg)",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              {a?.result === "not_ok" ? (
                <textarea
                  aria-label={`Catatan ${r.label}`}
                  value={a.note}
                  onChange={(e) => set(r.projectChecklistItemId, { note: e.target.value })}
                  rows={2}
                  placeholder="Catatan (wajib)"
                  className="mt-2 w-full rounded-lg border px-2 py-1 text-sm"
                  style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      <label className="flex flex-col gap-1">
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Catatan umum
        </span>
        <textarea
          name="notes"
          defaultValue={notes ?? ""}
          rows={2}
          className="w-full rounded-lg border px-3 py-2 text-base"
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
        />
      </label>

      {state.error ? (
        <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent)" }}
      >
        {pending ? "Menyimpan…" : "Simpan perubahan"}
      </button>
    </form>
  );
}
