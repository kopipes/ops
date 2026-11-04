"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { compressPhoto } from "@/lib/image-compression";
import { clearDraft, draftKey, loadDraft, newSubmissionId, saveDraft } from "@/lib/drafts";
import { enqueue, listJobs, processQueue, resumeQueue } from "@/lib/upload-queue";
import type { ReportFormActionState } from "@/app/report-actions";
import { formatReportTimestamp } from "@/lib/datetime";

export interface ChecklistItemView {
  id: string;
  label: string;
  description: string | null;
  categoryName: string;
  isRequired: boolean;
  requiresPhoto: boolean;
}

export interface ExistingReport {
  reportId: string;
  submittedByName: string | null;
  submittedAt: number | null;
  isLate: boolean;
  notes: string | null;
  phaseNote: string | null;
  handoverNote: string | null;
  latitude: string | null;
  longitude: string | null;
  locationAccuracyM: number | null;
  results: {
    label: string;
    categoryName: string;
    result: "ok" | "not_ok" | "na";
    note: string | null;
  }[];
}

interface Props {
  action: (prev: ReportFormActionState, formData: FormData) => Promise<ReportFormActionState>;
  phase: "opening" | "monitoring" | "closing";
  projectId: string;
  projectDayId: string;
  dayDate: string;
  timezone: string;
  items: ChecklistItemView[];
  readOnly: boolean;
  readOnlyReason?: string;
  existing: ExistingReport | null;
  monitoringCount: number;
  carryOverIssues: { id: string; code: string; title: string; severity: string }[];
  handoverFromYesterday: string | null;
}

type Answer = "ok" | "not_ok" | "na";

interface AnswerState {
  result: Answer | null;
  note: string;
  photoIds: string[];
  uploading: number;
}

const PHASE_TITLE: Record<Props["phase"], string> = {
  opening: "Opening",
  monitoring: "Monitoring",
  closing: "Closing",
};

export function ReportForm({
  action,
  phase,
  projectId,
  projectDayId,
  dayDate,
  timezone,
  items,
  readOnly,
  readOnlyReason,
  existing,
  monitoringCount,
  carryOverIssues,
  handoverFromYesterday,
}: Props) {
  const [answers, setAnswers] = useState<Record<string, AnswerState>>(() => {
    const init: Record<string, AnswerState> = {};
    for (const item of items) init[item.id] = { result: null, note: "", photoIds: [], uploading: 0 };
    return init;
  });
  const [notes, setNotes] = useState("");
  const [phaseNote, setPhaseNote] = useState(existing?.phaseNote ?? "");
  const [handoverNote, setHandoverNote] = useState(existing?.handoverNote ?? "");
  const [generalPhotoIds, setGeneralPhotoIds] = useState<string[]>([]);
  const [gps, setGps] = useState<{ lat: string; lng: string; acc: number } | null>(null);
  const [gpsDenied, setGpsDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const submissionIdRef = useRef(newSubmissionId());
  const key = draftKey(projectDayId, phase);

  // --- restore a local draft (§4.3 no.8) ---
  useEffect(() => {
    if (readOnly) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    (async () => {
      const draft = await loadDraft(key);
      if (!cancelled && draft) {
        const next: Record<string, AnswerState> = {};
        for (const item of items) next[item.id] = { result: null, note: "", photoIds: [], uploading: 0 };
        for (const r of draft.results) {
          if (next[r.projectChecklistItemId]) {
            next[r.projectChecklistItemId] = {
              result: r.result,
              note: r.note,
              photoIds: r.photoIds,
              uploading: 0,
            };
          }
        }
        setAnswers(next);
        setNotes(draft.notes);
        setPhaseNote(draft.phaseNote ?? "");
        setGeneralPhotoIds(draft.photoIds);
        if (draft.handoverNote) setHandoverNote(draft.handoverNote);
        submissionIdRef.current = draft.clientSubmissionId;
        setDraftRestored(true);
      }
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, items, readOnly]);

  // --- autosave on every change ---
  useEffect(() => {
    if (!hydrated || readOnly) return;
    const timer = setTimeout(() => {
      void saveDraft({
        key,
        projectId,
        projectDayId,
        phase,
        notes,
        phaseNote,
        observedAt: Date.now(),
        /*
         * Persist only items the crew actually answered. Coercing an unanswered
         * item to "ok" made the draft restore it as answered-but-photoless, so
         * submit then failed with "Foto wajib untuk item: …" for a form that
         * looked completely filled in.
         */
        results: Object.entries(answers)
          .filter(([, a]) => a.result !== null)
          .map(([id, a]) => ({
            projectChecklistItemId: id,
            result: a.result as "ok" | "not_ok" | "na",
            note: a.note,
            photoIds: a.photoIds,
          })),
        photoIds: generalPhotoIds,
        handoverNote: phase === "closing" ? handoverNote : undefined,
        clientSubmissionId: submissionIdRef.current,
        updatedAt: Date.now(),
      });
    }, 600);
    return () => clearTimeout(timer);
  }, [hydrated, readOnly, answers, notes, phaseNote, generalPhotoIds, handoverNote, key, projectId, projectDayId, phase]);

  // --- resume uploads left over from a previous session (§8.4) ---
  useEffect(() => {
    if (readOnly) return;
    void resumeQueue();
    const onOnline = () => {
      void processQueue();
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [readOnly]);

  // --- optional GPS (§8.5): never blocks submit ---
  useEffect(() => {
    if (readOnly || !navigator.geolocation) {
      setGpsDenied(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setGps({
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
          acc: Math.round(pos.coords.accuracy),
        }),
      () => setGpsDenied(true),
      { timeout: 5000, enableHighAccuracy: false, maximumAge: 60_000 },
    );
  }, [readOnly]);

  const setAnswer = useCallback(
    (id: string, patch: Partial<AnswerState>) => {
      setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    },
    [],
  );

  /**
   * Enqueues the photo in the durable queue (§8.4), then drains the queue.
   * The blob is persisted first, so closing the app mid-upload does not lose it.
   */
  const uploadPhoto = async (
    id: string | null,
    file: File,
    source: "camera" | "gallery" = "gallery",
  ) => {
    const patch = (fn: (a: AnswerState) => Partial<AnswerState>) => {
      if (id) setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], ...fn(prev[id]) } }));
    };

    if (id) patch((a) => ({ uploading: a.uploading + 1 }));
    setError(null);
    try {
      await enqueue({
        clientUploadId: newSubmissionId(),
        itemId: id,
        projectId,
        projectDayId,
        source,
        filename: file.name || "photo.jpg",
        blob: file,
      });

      // Offline: leave it queued and tell the crew honestly.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setError("Tidak ada koneksi — foto menunggu dan akan diunggah otomatis.");
        return;
      }

      const before = await listJobs();
      const pendingIds = new Set(
        before.filter((j) => j.status !== "done" && j.status !== "failed").map((j) => j.id),
      );

      await processQueue();

      // Collect every photo that finished, including ones from an earlier attempt.
      const jobs = await listJobs();
      const finished = jobs.filter((j) => j.status === "done" && j.photoId && pendingIds.has(j.id));

      for (const job of finished) {
        if (job.itemId) {
          setAnswers((prev) => {
            const cur = prev[job.itemId!];
            if (!cur || cur.photoIds.includes(job.photoId!)) return prev;
            return { ...prev, [job.itemId!]: { ...cur, photoIds: [...cur.photoIds, job.photoId!] } };
          });
        } else {
          setGeneralPhotoIds((prev) =>
            prev.includes(job.photoId!) ? prev : [...prev, job.photoId!],
          );
        }
      }

      const failedNow = jobs.filter(
        (j) => j.status === "failed" && pendingIds.has(j.id),
      );
      if (failedNow.length > 0) {
        setError(failedNow[0].lastError ?? "Sebagian foto gagal diunggah");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload gagal");
    } finally {
      if (id) patch((a) => ({ uploading: Math.max(0, a.uploading - 1) }));
    }
  };

  const answeredCount = items.filter((i) => answers[i.id]?.result).length;
  const progress = items.length === 0 ? 100 : Math.round((answeredCount / items.length) * 100);

  const onSubmit = async (formData: FormData) => {
    setError(null);
    setPending(true);
    formData.set("clientSubmissionId", submissionIdRef.current);
    const res = await action({}, formData);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    // Success: the draft is no longer needed. A fresh id is generated next time.
    await clearDraft(key);
    if (res.redirectTo) window.location.href = res.redirectTo;
  };

  // -------------------- read-only rendering --------------------
  if (readOnly) {
    return (
      <div className="flex flex-col gap-4">
        <div
          className="rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <p className="text-sm font-medium">
            {PHASE_TITLE[phase]} {existing ? "sudah diisi" : "tidak tersedia"}
            {existing?.isLate ? " · terlambat" : ""}
          </p>
          {existing ? (
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Diisi oleh {existing.submittedByName ?? "—"}
              {existing.submittedAt
                ? ` · Waktu pengisian: ${formatReportTimestamp(existing.submittedAt, timezone)}`
                : ""}
            </p>
          ) : null}
          {readOnlyReason ? (
            <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              {readOnlyReason}
            </p>
          ) : null}
        </div>

        {existing?.notes ? (
          <div
            className="rounded-xl border px-4 py-3"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Catatan umum
            </p>
            <p className="text-sm">{existing.notes}</p>
          </div>
        ) : null}

        {existing && existing.results.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {existing.results.map((r, i) => (
              <li
                key={`${r.label}-${i}`}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0">{r.label}</span>
                  <span
                    className="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
                    style={{
                      background:
                        r.result === "ok" ? "#dcfce7" : r.result === "not_ok" ? "#fee2e2" : "var(--border)",
                      color:
                        r.result === "ok" ? "#166534" : r.result === "not_ok" ? "#991b1b" : "var(--fg)",
                    }}
                  >
                    {r.result === "ok" ? "OK" : r.result === "not_ok" ? "Tidak OK" : "N/A"}
                  </span>
                </div>
                {r.note ? (
                  <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {r.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {existing?.phaseNote ? (
          <div
            className="rounded-xl border px-4 py-3"
            style={{ borderColor: "var(--accent)", background: "var(--surface)" }}
          >
            <p className="text-xs font-medium">
              {phase === "closing" ? "Laporan Akhir Hari" : "Laporan Awal Hari"}
            </p>
            <p className="text-sm whitespace-pre-wrap">{existing.phaseNote}</p>
          </div>
        ) : null}

        {existing?.handoverNote ? (
          <div
            className="rounded-xl border px-4 py-3"
            style={{ borderColor: "var(--border)", background: "var(--surface)" }}
          >
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Catatan untuk besok
            </p>
            <p className="text-sm">{existing.handoverNote}</p>
          </div>
        ) : null}
      </div>
    );
  }

  // -------------------- editable form --------------------
  const categories = [...new Set(items.map((i) => i.categoryName))];

  return (
    <form action={onSubmit} className="flex flex-col gap-4">
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectDayId" value={projectDayId} />
      <input type="hidden" name="phase" value={phase} />
      <input type="hidden" name="phaseNote" value={phaseNote} />
      {gps ? (
        <>
          <input type="hidden" name="latitude" value={gps.lat} />
          <input type="hidden" name="longitude" value={gps.lng} />
          <input type="hidden" name="locationAccuracyM" value={String(gps.acc)} />
        </>
      ) : null}

      {/* Progress (§4.3 no.6) */}
      {items.length > 0 ? (
        <div>
          <div className="mb-1 flex justify-between text-xs" style={{ color: "var(--muted)" }}>
            <span>
              {answeredCount}/{items.length} item
            </span>
            <span>{progress}%</span>
          </div>
          <div
            className="h-2 w-full overflow-hidden rounded-full"
            style={{ background: "var(--border)" }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress}%`, background: "var(--accent-solid)" }}
            />
          </div>
        </div>
      ) : null}

      {draftRestored ? (
        <p
          className="rounded-lg border px-3 py-2 text-xs"
          style={{ borderColor: "var(--border)", color: "var(--muted)" }}
        >
          Draft dipulihkan dari perangkat ini.
        </p>
      ) : null}

      {/* Checklist grouped by category (§4.3 no.2) */}
      {categories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
            {cat}
          </h2>
          <ul className="flex flex-col gap-2">
            {items
              .filter((i) => i.categoryName === cat)
              .map((item) => {
                const a = answers[item.id];
                return (
                  <li
                    key={item.id}
                    className="rounded-xl border px-3 py-2"
                    style={{ borderColor: "var(--border)", background: "var(--surface)" }}
                  >
                    <p className="text-sm font-medium">
                      {item.label}
                      {item.isRequired ? (
                        <span style={{ color: "#dc2626" }} aria-label="wajib">
                          {" "}
                          *
                        </span>
                      ) : null}
                    </p>
                    {item.description ? (
                      <p className="text-xs" style={{ color: "var(--muted)" }}>
                        {item.description}
                      </p>
                    ) : null}

                    <input type="hidden" name={`r_${item.id}`} value={a?.result ?? ""} />
                    <input type="hidden" name={`note_${item.id}`} value={a?.note ?? ""} />
                    {(a?.photoIds ?? []).map((pid) => (
                      <input key={pid} type="hidden" name={`photos_${item.id}`} value={pid} />
                    ))}

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
                            onClick={() => setAnswer(item.id, { result: value })}
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
                      <div className="mt-2">
                        <label
                          htmlFor={`n-${item.id}`}
                          className="text-xs"
                          style={{ color: "var(--muted)" }}
                        >
                          Catatan (wajib)
                        </label>
                        <textarea
                          id={`n-${item.id}`}
                          value={a.note}
                          onChange={(e) => setAnswer(item.id, { note: e.target.value })}
                          rows={2}
                          className="w-full rounded-lg border px-2 py-1 text-sm"
                          style={{
                            background: "var(--surface)",
                            borderColor: "var(--border)",
                            color: "var(--fg)",
                          }}
                        />
                        {/* §4.3 no.3: optional shortcut, never automatic. */}
                        <a
                          href={`/issues/new?projectId=${encodeURIComponent(projectId)}${
                            a.note.trim()
                              ? `&title=${encodeURIComponent(item.label)}&description=${encodeURIComponent(a.note.trim())}`
                              : `&title=${encodeURIComponent(item.label)}`
                          }&phase=${phase}`}
                          className="mt-1 inline-flex min-h-[36px] items-center rounded-lg border px-3 text-xs"
                          style={{ borderColor: "var(--border)", color: "var(--accent)" }}
                        >
                          Jadikan Issue
                        </a>
                      </div>
                    ) : null}

                    {item.requiresPhoto || a?.result === "not_ok" ? (
                      <div className="mt-2">
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                          Foto{item.requiresPhoto ? " (wajib)" : ""}
                        </p>
                        <div className="mt-1 flex gap-2">
                          <label
                            className="flex min-h-tap flex-1 cursor-pointer items-center justify-center rounded-lg border text-xs"
                            style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                          >
                            Ambil Foto
                            <input
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="sr-only"
                              aria-label={`Ambil foto untuk ${item.label}`}
                              onChange={(e) => {
                                const files = Array.from(e.target.files ?? []);
                                for (const f of files) void uploadPhoto(item.id, f, "camera");
                                e.target.value = "";
                              }}
                            />
                          </label>
                          <label
                            className="flex min-h-tap flex-1 cursor-pointer items-center justify-center rounded-lg border text-xs"
                            style={{ borderColor: "var(--border)", color: "var(--fg)" }}
                          >
                            Dari Galeri
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              className="sr-only"
                              aria-label={`Pilih foto galeri untuk ${item.label}`}
                              onChange={(e) => {
                                const files = Array.from(e.target.files ?? []);
                                for (const f of files) void uploadPhoto(item.id, f, "gallery");
                                e.target.value = "";
                              }}
                            />
                          </label>
                        </div>
                        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                          {a?.uploading ? `Mengupload ${a.uploading} foto…` : ""}
                          {a && a.photoIds.length > 0 ? `${a.photoIds.length} foto terlampir` : ""}
                        </p>
                      </div>
                    ) : null}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      {/* Narrative report after the checklist — opening & closing only. */}
      {phase !== "monitoring" ? (
        <section
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: "var(--accent)", background: "var(--surface)" }}
        >
          <label htmlFor="phaseNote" className="text-sm font-semibold">
            {phase === "closing" ? "Laporan Akhir Hari" : "Laporan Awal Hari"}
          </label>
          <p className="mt-0.5 text-xs" style={{ color: "var(--muted)" }}>
            {phase === "closing"
              ? "Ringkas kondisi akhir hari setelah checklist closing selesai."
              : "Ringkas kondisi saat memulai hari, setelah checklist opening selesai."}
          </p>
          <textarea
            id="phaseNote"
            value={phaseNote}
            onChange={(e) => setPhaseNote(e.target.value)}
            rows={4}
            placeholder={
              phase === "closing"
                ? "mis. Semua area bersih, 2 issue tersisa untuk besok, vendor lighting akan datang jam 9."
                : "mis. Area siap, 10 crew hadir, genset siaga."
            }
            className="mt-2 w-full rounded-lg border px-3 py-2 text-base"
            style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
          />
        </section>
      ) : null}

      {/* General notes + photos (§4.3 no.4) */}
      <section>
        <label htmlFor="notes" className="text-sm font-medium" style={{ color: "var(--muted)" }}>
          {phase === "monitoring" ? "Observasi / catatan (wajib)" : "Catatan umum (opsional)"}
        </label>
        <textarea
          id="notes"
          name="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          required={phase === "monitoring"}
          className="mt-1 w-full rounded-lg border px-3 py-2 text-base"
          style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
        />

        <label htmlFor="general-photo" className="mt-2 block text-sm" style={{ color: "var(--muted)" }}>
          Foto umum (opsional, tanpa batas jumlah)
        </label>
        <div className="mt-1 flex gap-2">
          <label
            className="flex min-h-tap flex-1 cursor-pointer items-center justify-center rounded-lg border text-xs"
            style={{ borderColor: "var(--border)", color: "var(--fg)" }}
          >
            Ambil Foto
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              aria-label="Ambil foto umum"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                for (const f of files) void uploadPhoto(null, f, "camera");
                e.target.value = "";
              }}
            />
          </label>
          <label
            className="flex min-h-tap flex-1 cursor-pointer items-center justify-center rounded-lg border text-xs"
            style={{ borderColor: "var(--border)", color: "var(--fg)" }}
          >
            Dari Galeri
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              aria-label="Pilih foto umum dari galeri"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                for (const f of files) void uploadPhoto(null, f, "gallery");
                e.target.value = "";
              }}
            />
          </label>
        </div>
        {generalPhotoIds.map((pid) => (
          <input key={pid} type="hidden" name="generalPhotos" value={pid} />
        ))}
        {generalPhotoIds.length > 0 ? (
          <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
            {generalPhotoIds.length} foto terlampir
          </p>
        ) : null}
      </section>

      {/* GPS status (§8.5) */}
      <p className="text-xs" style={{ color: "var(--muted)" }}>
        {gps
          ? `📍 lokasi terekam (±${gps.acc} m)`
          : gpsDenied
            ? "📍 lokasi tidak tersedia"
            : "📍 mengambil lokasi…"}
      </p>

      {/* Closing: handover + summary (§4.5) */}
      {phase === "closing" ? (
        <section>
          <label htmlFor="handover" className="text-sm font-medium" style={{ color: "var(--muted)" }}>
            Catatan untuk besok (handover)
          </label>
          <textarea
            id="handover"
            name="handoverNote"
            value={handoverNote}
            onChange={(e) => setHandoverNote(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border px-3 py-2 text-base"
            style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
          />
        </section>
      ) : null}

      {/* Carry-over issues (§4.3 no.5, §4.5) */}
      {carryOverIssues.length > 0 ? (
        <section>
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="text-sm font-medium" style={{ color: "var(--muted)" }}>
              Issue terbawa ({carryOverIssues.length})
            </h2>
            <a
              href={`/issues/new?projectId=${encodeURIComponent(projectId)}&phase=${phase}`}
              className="rounded-md border px-2 py-1 text-xs"
              style={{ borderColor: "var(--border)", color: "var(--accent)" }}
            >
              + Issue Baru
            </a>
          </div>
          <ul className="flex flex-col gap-1">
            {carryOverIssues.map((i) => (
              <li
                key={i.id}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--surface)" }}
              >
                <span className="text-xs" style={{ color: "var(--muted)" }}>
                  {i.code} · {i.severity}
                </span>
                <p>{i.title}</p>
              </li>
            ))}
          </ul>
          <a
            href={`/issues?status=open`}
            className="mt-1 inline-flex min-h-[36px] items-center rounded-lg border px-3 text-xs"
            style={{ borderColor: "var(--border)", color: "var(--accent)" }}
          >
            Kelola issue
          </a>
        </section>
      ) : null}

      {handoverFromYesterday ? (
        <div
          className="rounded-xl border px-4 py-3"
          style={{ borderColor: "var(--border)", background: "var(--surface)" }}
        >
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Catatan handover dari hari sebelumnya
          </p>
          <p className="text-sm">{handoverFromYesterday}</p>
        </div>
      ) : null}

      {phase === "monitoring" ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Sudah ada {monitoringCount} laporan monitoring hari ini. Kamu bisa menambah lagi kapan saja.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "#dc2626", color: "#dc2626" }}>
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent-solid)" }}
      >
        {pending ? "Mengirim…" : `Submit ${PHASE_TITLE[phase]}`}
      </button>
      <p className="text-center text-xs" style={{ color: "var(--muted)" }}>
        Draft tersimpan otomatis di perangkat ini.
      </p>
    </form>
  );
}
