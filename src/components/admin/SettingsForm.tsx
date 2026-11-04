"use client";

import { startTransition, useActionState, useState } from "react";
import type { SettingsActionState } from "@/app/settings-actions";
import type { GlobalSettings } from "@/server/services/app-settings";

const inputCls = "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
const inputStyle = {
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--fg)",
} as const;

export function SettingsForm({
  action,
  initial,
}: {
  action: (prev: SettingsActionState, formData: FormData) => Promise<SettingsActionState>;
  initial: GlobalSettings;
}) {
  const [state, formAction, pending] = useActionState(action, {} as SettingsActionState);
  const [openingEnabled, setOpeningEnabled] = useState(initial.openingWindowEnabled);
  const [closingEnabled, setClosingEnabled] = useState(initial.closingWindowEnabled);

  return (
    // Submit this settings editor explicitly: React's automatic action-form
    // reset restores old checkbox/time defaults after the values are saved.
    <form action={formAction} onSubmit={event => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      startTransition(() => formAction(formData));
    }} className="flex flex-col gap-3">
      <label className="flex min-h-tap items-center gap-3 text-sm">
        <input type="checkbox" name="openingWindowEnabled" checked={openingEnabled} onChange={e => setOpeningEnabled(e.target.checked)} className="h-5 w-5" />
        Gunakan window opening
      </label>
      {!openingEnabled ? <p className="text-xs" style={{ color: "var(--muted)" }}>Opening bebas jam. Waktu pengisian tetap dicatat otomatis.</p> : null}
      <fieldset disabled={!openingEnabled} hidden={!openingEnabled} className={openingEnabled ? "flex flex-col gap-2" : "hidden"}>
        <legend className="text-sm font-medium" style={{ color: "var(--muted)" }}>
          Window opening default
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Mulai
            <input
              type="time"
              name="defaultOpeningWindowStart"
              defaultValue={initial.defaultOpeningWindowStart}
              className={inputCls}
              style={inputStyle}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Selesai
            <input
              type="time"
              name="defaultOpeningWindowEnd"
              defaultValue={initial.defaultOpeningWindowEnd}
              className={inputCls}
              style={inputStyle}
            />
          </label>
        </div>
      </fieldset>

      <label className="flex min-h-tap items-center gap-3 text-sm">
        <input type="checkbox" name="closingWindowEnabled" checked={closingEnabled} onChange={e => setClosingEnabled(e.target.checked)} className="h-5 w-5" />
        Gunakan window closing
      </label>
      {!closingEnabled ? <p className="text-xs" style={{ color: "var(--muted)" }}>Closing bebas jam. Waktu pengisian tetap dicatat otomatis.</p> : null}
      <fieldset disabled={!closingEnabled} hidden={!closingEnabled} className={closingEnabled ? "flex flex-col gap-2" : "hidden"}>
        <legend className="text-sm font-medium" style={{ color: "var(--muted)" }}>
          Window closing default
        </legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Mulai
            <input
              type="time"
              name="defaultClosingWindowStart"
              defaultValue={initial.defaultClosingWindowStart}
              className={inputCls}
              style={inputStyle}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted)" }}>
            Selesai
            <input
              type="time"
              name="defaultClosingWindowEnd"
              defaultValue={initial.defaultClosingWindowEnd}
              className={inputCls}
              style={inputStyle}
            />
          </label>
        </div>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="text-sm" style={{ color: "var(--muted)" }}>
          Timezone default
        </span>
        <select
          name="defaultTimezone"
          defaultValue={initial.defaultTimezone}
          className={inputCls}
          style={inputStyle}
        >
          <option value="Asia/Jakarta">WIB — Asia/Jakarta</option>
          <option value="Asia/Makassar">WITA — Asia/Makassar</option>
          <option value="Asia/Jayapura">WIT — Asia/Jayapura</option>
        </select>
      </label>

      <p className="text-xs" style={{ color: "var(--muted)" }}>
        Tidak ada setelan batas jumlah foto — jumlah foto tidak dibatasi (§8.1).
      </p>

      {state.error ? (
        <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="text-sm" style={{ color: "#166534" }}>
          Setelan tersimpan.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent-solid)" }}
      >
        {pending ? "Menyimpan…" : "Simpan setelan"}
      </button>
    </form>
  );
}
