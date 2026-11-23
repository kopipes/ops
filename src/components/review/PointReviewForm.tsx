"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { pointReviewAction } from "@/app/review-actions";

const ACTIONS = [
  { value: "re_take_photo", label: "Re-Take" },
  { value: "others", label: "Others" },
] as const;
type Action = (typeof ACTIONS)[number]["value"];

export function PointReviewForm({
  checkResultId, photoId, contentHash,
}: { checkResultId?: string; photoId?: string; contentHash: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [notOk, setNotOk] = useState(false);
  const [selected, setSelected] = useState<Action | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const submitting = useRef(false);
  const submissionId = useRef<string | null>(null);
  useEffect(() => setReady(true), []);

  function clearSubmission() {
    submissionId.current = null;
    setError(undefined);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || submitting.current) return;
    const data = new FormData(event.currentTarget);
    submitting.current = true;
    setPending(true);
    setError(undefined);
    submissionId.current ??= crypto.randomUUID();
    data.set("id", submissionId.current);
    data.set("verdict", notOk ? "not_ok" : "ok");
    try {
      const result = await pointReviewAction({}, data);
      if (result.ok) {
        setNotOk(false);
        setSelected(null);
        clearSubmission();
        router.refresh();
      } else {
        setError(result.error ?? "Review belum tersimpan. Coba lagi.");
      }
    } catch {
      setError("Review belum tersimpan. Coba lagi.");
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 border-t border-[var(--border)] pt-2">
      {photoId ? <input type="hidden" name="photoId" value={photoId} /> : <input type="hidden" name="checkResultId" value={checkResultId} />}
      <input type="hidden" name="contentHash" value={contentHash} />
      <fieldset disabled={!ready || pending} className="min-w-0">
        <legend className="sr-only">{photoId ? "Review foto" : "Review poin"}</legend>
        <div className="flex flex-wrap items-center gap-x-3">
          <label className="inline-flex min-h-tap items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={notOk} onChange={(event) => {
              setNotOk(event.target.checked);
              setSelected(null);
              clearSubmission();
            }} />
            Tidak OK
          </label>
          {!notOk ? <button type="submit" className="min-h-tap px-2 text-xs font-semibold text-[var(--accent)] disabled:opacity-60">Tandai OK</button> : null}
        </div>
        {notOk ? (
          <div className="flex flex-col gap-2">
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">Tindak lanjut</legend>
              {ACTIONS.map(({ value, label }) => (
                <label key={value} className={`inline-flex min-h-tap items-center gap-2 rounded-lg border px-3 text-sm ${selected === value ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)]"}`}>
                  <input type="radio" name="action" value={value} required checked={selected === value} onChange={() => {
                    setSelected(value);
                    clearSubmission();
                  }} />
                  {label}
                </label>
              ))}
            </fieldset>
            {selected === "others" ? (
              <label className="grid gap-1 text-sm">
                Apa yang perlu diperbaiki?
                <textarea name="note" required maxLength={2000} rows={2} onChange={clearSubmission}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-base" />
              </label>
            ) : null}
            <button type="submit" disabled={!selected} className="btn-primary self-start text-xs disabled:opacity-60">
              {pending ? "Menyimpan…" : photoId ? "Simpan review foto" : "Simpan review poin"}
            </button>
          </div>
        ) : null}
        {error ? <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{error}</p> : null}
      </fieldset>
    </form>
  );
}
