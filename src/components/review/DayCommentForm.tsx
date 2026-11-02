"use client";

import { useActionState } from "react";
import type { ReviewActionState } from "@/app/review-actions";

export function DayCommentForm({
  projectDayId,
  action,
}: {
  projectDayId: string;
  action: (prev: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, {} as ReviewActionState);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="projectDayId" value={projectDayId} />
      <label htmlFor="day-comment" className="text-xs" style={{ color: "var(--muted)" }}>
        Komentar review (terlihat oleh crew)
      </label>
      <textarea
        id="day-comment"
        name="body"
        rows={2}
        required
        maxLength={2000}
        className="w-full rounded-lg border px-3 py-2 text-sm"
        style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
      />
      {state.error ? (
        <p role="alert" className="text-xs" style={{ color: "#dc2626" }}>
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p className="text-xs" style={{ color: "#166534" }}>
          Komentar terkirim.
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent)" }}
      >
        {pending ? "Mengirim…" : "Kirim komentar"}
      </button>
    </form>
  );
}
