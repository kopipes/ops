"use client";

import { useActionState, useEffect } from "react";
import type { ExportResult } from "@/app/pdf-actions";

/**
 * Export controls for §7.5. The options match the PRD exactly:
 * "sertakan foto" and "mode klien".
 *
 * The PDF arrives as a base64 data URL and is saved through a temporary anchor,
 * so no server-side file has to persist on the VPS (§10.1 disk budget).
 */
export function ExportPdfForm({
  action,
  hidden,
  submitLabel,
  showDateRange,
  defaultFrom,
  defaultTo,
  hint,
}: {
  action: (prev: ExportResult, formData: FormData) => Promise<ExportResult>;
  hidden: Record<string, string>;
  submitLabel: string;
  showDateRange?: boolean;
  defaultFrom?: string;
  defaultTo?: string;
  hint?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ExportResult);

  // Trigger the download when the server returns the payload.
  useEffect(() => {
    if (!state.ok || !state.dataUrl || !state.filename) return;
    const a = document.createElement("a");
    a.href = state.dataUrl;
    a.download = state.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [state]);

  const inputStyle = {
    background: "var(--surface)",
    borderColor: "var(--border)",
    color: "var(--fg)",
  } as const;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}

      {showDateRange ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Dari
            <input
              type="date"
              name="from"
              defaultValue={defaultFrom}
              className="min-h-[40px] rounded-lg border px-2 text-sm"
              style={inputStyle}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Sampai
            <input
              type="date"
              name="to"
              defaultValue={defaultTo}
              className="min-h-[40px] rounded-lg border px-2 text-sm"
              style={inputStyle}
            />
          </label>
        </div>
      ) : null}

      <label className="flex min-h-[36px] items-center gap-2 text-sm">
        <input type="checkbox" name="includePhotos" defaultChecked className="h-4 w-4" />
        Sertakan foto
      </label>
      <label className="flex min-h-[36px] items-center gap-2 text-sm">
        <input type="checkbox" name="clientMode" className="h-4 w-4" />
        Mode klien (sembunyikan komentar internal)
      </label>

      {state.error ? (
        <p role="alert" className="text-xs" style={{ color: "#dc2626" }}>
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="text-xs" style={{ color: "#166534" }}>
          PDF dibuat — unduhan dimulai.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
      >
        {pending ? "Menyiapkan PDF…" : submitLabel}
      </button>

      {hint ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {hint}
        </p>
      ) : null}
    </form>
  );
}
