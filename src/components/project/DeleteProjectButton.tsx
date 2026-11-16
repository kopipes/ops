"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { deleteProjectAction } from "@/app/project-actions";

export function DeleteProjectButton({ projectId, projectName, projectCode }: {
  projectId: string; projectName: string; projectCode: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const title = useId();
  const description = useId();
  const reason = useId();
  const code = useId();
  const [state, action, pending] = useActionState(deleteProjectAction, {});
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);
  useEffect(() => { setError(state.error); }, [state]);
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  return <>
    <button type="button" className="inline-flex min-h-tap items-center gap-2 rounded-xl border border-red-600/30 px-3 text-xs font-medium text-red-700 dark:text-red-300" onClick={() => {
      form.current?.reset(); setError(undefined); setOpen(true); dialog.current?.showModal();
    }}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6m4-6v6" /></svg>
      Hapus project
    </button>
    <dialog ref={dialog} aria-labelledby={title} aria-describedby={description} onClose={() => setOpen(false)} onCancel={event => { if (pending) event.preventDefault(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(480px,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-2xl border p-6 shadow-2xl backdrop:bg-black/60"
      style={{ background: "var(--surface)", color: "var(--fg)", borderColor: "var(--border)" }}>
      <h2 id={title} className="text-lg font-semibold tracking-tight">Hapus project?</h2>
      <p className="mt-2 break-words text-sm font-medium">{projectName}</p>
      <p id={description} className="mt-2 text-sm text-[var(--muted)]">Project beserta laporan dan issues-nya akan disembunyikan dari aplikasi. Data dan foto tetap disimpan untuk audit.</p>
      <form ref={form} action={action} className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="projectId" value={projectId} />
        <label htmlFor={reason} className="flex flex-col gap-2 text-xs font-medium">Alasan penghapusan
          <textarea id={reason} name="reason" required minLength={3} maxLength={1000} rows={3} disabled={pending} className="rounded-xl border bg-[var(--bg)] p-3 text-base sm:text-sm" style={{ borderColor: "var(--border)" }} />
        </label>
        <label htmlFor={code} className="flex flex-col gap-2 text-xs font-medium"><span>Ketik kode <strong className="break-all">{projectCode}</strong> untuk konfirmasi</span>
          <input id={code} name="confirmationCode" required maxLength={80} autoComplete="off" spellCheck={false} disabled={pending} className="min-h-tap rounded-xl border bg-[var(--bg)] px-3 text-base sm:text-sm" style={{ borderColor: "var(--border)" }} />
        </label>
        {error ? <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus disabled={pending} onClick={() => dialog.current?.close()} className="btn-secondary disabled:opacity-60">Batal</button>
          <button type="submit" disabled={pending} className="min-h-tap rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">{pending ? "Menghapus…" : "Ya, hapus project"}</button>
        </div>
      </form>
    </dialog>
  </>;
}
