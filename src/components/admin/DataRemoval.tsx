"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { previewRemovalAction, reactivateDataAction, removeDataAction } from "@/app/data-removal-actions";
import type { RemovalEntity, RemovalPreview, RemovalState } from "@/lib/data-removal";

export function RemoveDataButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} className="min-h-tap rounded-lg border border-red-600/30 px-3 text-xs font-medium text-red-700 dark:text-red-300">Hapus</button>;
}


export function ReactivateDataButton({ entity, id }: { entity: "template" | "checklist_category" | "issue_category"; id: string }) {
  const [state, action, pending] = useActionState(reactivateDataAction, {} as RemovalState);
  return <form action={action}>
    <input type="hidden" name="entity" value={entity} /><input type="hidden" name="id" value={id} />
    <button type="submit" disabled={pending} className="min-h-tap rounded-lg border border-emerald-600/30 px-3 text-xs font-medium text-emerald-800 dark:text-emerald-300 disabled:opacity-60">{pending ? "Mengaktifkan…" : "Aktifkan"}</button>
    {state.error ? <p role="alert" className="mt-1 text-xs text-red-700">{state.error}</p> : null}
    {state.ok ? <p role="status" className="mt-1 text-xs">{state.message}</p> : null}
  </form>;
}

/** One dialog per list, so a deleted row unmounting does not lose the result. */
export function useDataRemoval() {
  const [target, setTarget] = useState<{ entity: RemovalEntity; id: string }>();
  const [message, setMessage] = useState("");
  const close = useCallback(() => setTarget(undefined), []);
  const success = useCallback((value: string) => { setMessage(value); setTarget(undefined); }, []);
  return {
    requestRemoval: (entity: RemovalEntity, id: string) => { setMessage(""); setTarget({ entity, id }); },
    removalNotice: message ? <p role="status" className="rounded-xl border border-emerald-600/20 bg-emerald-500/5 p-3 text-sm text-emerald-800 dark:text-emerald-300">{message}</p> : null,
    removalDialog: target ? <DataRemovalDialog key={`${target.entity}:${target.id}`} {...target} onClose={close} onSuccess={success} /> : null,
  };
}

function DataRemovalDialog({ entity, id, onClose, onSuccess }: {
  entity: RemovalEntity; id: string; onClose: () => void; onSuccess: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const description = useId();
  const confirmation = useId();
  const reason = useId();
  const [preview, setPreview] = useState<RemovalPreview>();
  const [error, setError] = useState("");
  const [state, action, pending] = useActionState(removeDataAction, {} as RemovalState);
  useEffect(() => {
    dialog.current?.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let cancelled = false;
    previewRemovalAction(entity, id).then(result => {
      if (cancelled) return;
      setPreview(result.preview); setError(result.error ?? "");
    }).catch(() => { if (!cancelled) setError("Tidak dapat memeriksa data. Tutup dialog lalu coba lagi."); });
    return () => { cancelled = true; document.body.style.overflow = previous; };
  }, [entity, id]);
  useEffect(() => { if (state.ok) onSuccess(state.message ?? "Data berhasil diproses."); }, [state, onSuccess]);
  const archive = preview?.mode === "archive";
  return <dialog ref={dialog} aria-labelledby={heading} aria-describedby={description} onClose={onClose} onCancel={event => { if (pending) event.preventDefault(); }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(480px,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-2xl border p-6 shadow-2xl backdrop:bg-black/60"
    style={{ background: "var(--surface)", color: "var(--fg)", borderColor: "var(--border)" }}>
    <h2 id={heading} className="text-lg font-semibold">{preview ? archive ? "Arsipkan data?" : "Hapus permanen?" : "Memeriksa penggunaan data…"}</h2>
    <p className="mt-2 break-words text-sm font-medium">{preview?.name}</p>
    <p id={description} className="mt-2 text-sm text-[var(--muted)]">{preview ? archive
      ? "Data perlu dipertahankan untuk menjaga riwayat. Data akan dinonaktifkan dan disembunyikan dari daftar aktif. Riwayat laporan dan data terkait tetap tersimpan; gunakan filter nonaktif untuk melihatnya."
      : "Data belum digunakan. Data ini akan dihapus permanen dan tidak dapat dikembalikan. Tindakan tercatat di audit."
      : "Sedang memeriksa hubungan data sebelum menentukan tindakan yang aman."}</p>
    {error || state.error ? <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error || state.error}</p> : null}
    <form action={action} className="mt-5 flex flex-col gap-4">
      {preview ? <>
        <input type="hidden" name="entity" value={entity} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="expectedMode" value={preview.mode} />
        <label htmlFor={reason} className="flex flex-col gap-2 text-xs font-medium">Alasan
          <textarea id={reason} name="reason" required minLength={3} maxLength={1000} rows={3} disabled={pending} className="rounded-xl border bg-[var(--bg)] p-3 text-base" style={{ borderColor: "var(--border)" }} />
        </label>
        <label htmlFor={confirmation} className="flex flex-col gap-2 text-xs font-medium"><span>Ketik <strong className="break-all">{preview.name}</strong> untuk konfirmasi</span>
          <input id={confirmation} name="confirmation" required maxLength={500} autoComplete="off" spellCheck={false} disabled={pending} className="min-h-tap rounded-xl border bg-[var(--bg)] px-3 text-base" style={{ borderColor: "var(--border)" }} />
        </label>
      </> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" autoFocus disabled={pending} onClick={() => dialog.current?.close()} className="btn-secondary disabled:opacity-60">Batal</button>
        {preview ? <button type="submit" disabled={pending} className="min-h-tap rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{pending ? "Memproses…" : archive ? "Ya, arsipkan" : "Ya, hapus permanen"}</button> : null}
      </div>
    </form>
  </dialog>;
}
