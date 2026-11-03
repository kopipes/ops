"use client";

import { useEffect, useId, useRef, useState } from "react";

export interface ReportPhoto {
  id: string;
  label: string;
  caption?: string;
}

/** Native modal blocks the background and restores focus; Tab cycles its controls. */
export function PhotoGallery({ photos, small = false }: { photos: ReportPhoto[]; small?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const isOpen = active !== null;
  const selected = active === null ? null : photos[active];

  useEffect(() => {
    if (isOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!isOpen && dialog.current?.open) dialog.current.close();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [isOpen]);

  function show(index: number) {
    setFailed(false);
    setActive((index + photos.length) % photos.length);
  }

  if (!photos.length) return null;
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2">
        {photos.map((photo, index) => (
          <button
            key={photo.id}
            type="button"
            aria-label={`Perbesar ${photo.label}`}
            onClick={() => show(index)}
            className="overflow-hidden rounded-lg border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            style={{ borderColor: "var(--border)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/photos/${photo.id}?v=thumb`} alt={photo.label} loading="lazy" className={small ? "h-14 w-14 object-cover" : "h-16 w-16 object-cover lg:h-24 lg:w-24"} />
          </button>
        ))}
      </div>
      <dialog
        ref={dialog}
        aria-labelledby={headingId}
        onCancel={() => setActive(null)}
        onClose={() => setActive(null)}
        onClick={event => { if (event.target === event.currentTarget) setActive(null); }}
        onKeyDown={event => {
          if (event.key === "Tab") {
            const controls = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (first && last && ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last))) {
              event.preventDefault();
              (event.shiftKey ? last : first).focus();
            }
            return;
          }
          if (active === null || photos.length < 2) return;
          if (event.key === "ArrowLeft") { event.preventDefault(); show(active - 1); }
          if (event.key === "ArrowRight") { event.preventDefault(); show(active + 1); }
        }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[min(1100px,calc(100vw-2rem))] max-w-none overflow-y-auto rounded-xl border p-0 shadow-2xl backdrop:bg-black/80"
        style={{ color: "var(--fg)", background: "var(--surface)", borderColor: "var(--border)" }}
      >
        {selected ? (
          <div>
            <div className="flex items-center justify-between gap-3 border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
              <h2 id={headingId} className="min-w-0 text-sm font-medium">{selected.label}</h2>
              <button type="button" onClick={() => setActive(null)} autoFocus aria-label="Tutup foto" className="min-w-tap shrink-0 rounded-lg px-3 text-xl">×</button>
            </div>
            {failed ? <p role="alert" className="p-6 text-sm">Foto tidak dapat dimuat. Tutup lalu buka kembali untuk mencoba lagi.</p> : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img key={selected.id} src={`/api/photos/${selected.id}`} alt={selected.label} onError={() => setFailed(true)} className="mx-auto max-h-[65dvh] w-full object-contain" />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border)" }}>
              <div className="min-w-0 flex-1 text-xs" aria-live="polite">
                <p className="font-medium">Foto {(active ?? 0) + 1} dari {photos.length}</p>
                {selected.caption ? <p className="mt-1" style={{ color: "var(--muted)" }}>{selected.caption}</p> : null}
              </div>
              {photos.length > 1 ? <div className="flex gap-2">
                <button type="button" aria-label="Foto sebelumnya" onClick={() => show((active ?? 0) - 1)} className="min-w-tap rounded-lg border px-3" style={{ borderColor: "var(--border)" }}>←</button>
                <button type="button" aria-label="Foto berikutnya" onClick={() => show((active ?? 0) + 1)} className="min-w-tap rounded-lg border px-3" style={{ borderColor: "var(--border)" }}>→</button>
              </div> : null}
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
