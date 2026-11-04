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
        className="btn-primary mt-2 min-h-[48px] w-full disabled:cursor-wait disabled:opacity-60"
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
  required = true,
  minLength,
  maxLength,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "text" | "email" | "numeric";
  required?: boolean;
  minLength?: number;
  maxLength?: number;
}) {
  const id = `f-${name}`;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        inputMode={inputMode}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        className="min-h-[48px] rounded-xl border px-3.5 py-3 text-base sm:text-sm"
        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
      />
    </div>
  );
}
