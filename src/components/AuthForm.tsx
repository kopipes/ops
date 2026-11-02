"use client";

import { useActionState } from "react";
import type { FormState } from "@/app/auth-actions";

interface Props {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  children: React.ReactNode;
}

/** Shared form wrapper: pending state + inline error (§9.4 basic a11y). */
export function AuthForm({ action, submitLabel, children }: Props) {
  const [state, formAction, pending] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {children}

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--status-notok,#dc2626)]">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent)" }}
      >
        {pending ? "Memproses…" : submitLabel}
      </button>
    </form>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  inputMode,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric";
}) {
  const id = `f-${name}`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm" style={{ color: "var(--muted)" }}>
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required
        className="min-h-tap rounded-lg border px-3 py-3 text-base outline-none focus:ring-2"
        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
      />
    </div>
  );
}
