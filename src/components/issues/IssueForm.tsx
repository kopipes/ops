"use client";

import { useActionState, useState } from "react";
import { compressPhoto } from "@/lib/image-compression";
import { SEVERITIES, severityLabel } from "@/lib/schemas";
import type { IssueActionState } from "@/app/issue-actions";

export interface IssueFormValues {
  issueId?: string;
  projectId: string;
  projectDayId: string;
  phase: string;
  title: string;
  description: string;
  categoryId: string;
  severity: string;
  nextStep: string;
  picUserId: string;
  picExternal: string;
  dueAt: string;
  photoIds: string[];
  checkResultId?: string;
  reportId?: string;
}

interface Props {
  action: (prev: IssueActionState, formData: FormData) => Promise<IssueActionState>;
  projects: { id: string; name: string; code: string }[];
  categories: { id: string; name: string }[];
  members: { userId: string; name: string }[];
  initial?: Partial<IssueFormValues>;
  submitLabel: string;
  /** Photos already attached (edit mode). */
  existingPhotos?: { id: string; thumbPath: string }[];
}

const inputCls = "min-h-tap w-full rounded-lg border px-3 py-2 text-base outline-none";
const inputStyle = {
  background: "var(--surface)",
  borderColor: "var(--border)",
  color: "var(--fg)",
} as const;

export function IssueForm({
  action,
  projects,
  categories,
  members,
  initial,
  submitLabel,
  existingPhotos = [],
}: Props) {
  const [state, formAction, pending] = useActionState(action, {} as IssueActionState);

  const [projectId, setProjectId] = useState(initial?.projectId ?? projects[0]?.id ?? "");
  const [severity, setSeverity] = useState(initial?.severity ?? "medium");
  const [photoIds, setPhotoIds] = useState<string[]>(initial?.photoIds ?? []);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [picMode, setPicMode] = useState<"user" | "external">(
    initial?.picExternal ? "external" : "user",
  );

  const uploadPhoto = async (file: File) => {
    setUploadError(null);
    setUploading((n) => n + 1);
    try {
      const compressed = await compressPhoto(file);
      const fd = new FormData();
      fd.set("projectId", projectId);
      fd.set("projectDayId", initial?.projectDayId ?? "");
      fd.set("file", new File([compressed.blob], "photo.webp", { type: compressed.blob.type }));
      fd.set("source", "gallery");
      if (compressed.takenAt) fd.set("takenAt", String(compressed.takenAt));

      const res = await fetch("/api/photos", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Upload gagal");
      }
      const { photoId } = (await res.json()) as { photoId: string };
      setPhotoIds((prev) => [...prev, photoId]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload gagal");
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  };

  const totalPhotos = photoIds.length + existingPhotos.length;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {initial?.issueId ? <input type="hidden" name="issueId" value={initial.issueId} /> : null}
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="projectDayId" value={initial?.projectDayId ?? ""} />
      <input type="hidden" name="phase" value={initial?.phase ?? ""} />
      <input type="hidden" name="checkResultId" value={initial?.checkResultId ?? ""} />
      <input type="hidden" name="reportId" value={initial?.reportId ?? ""} />
      {photoIds.map((id) => (
        <input key={id} type="hidden" name="photoIds" value={id} />
      ))}

      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="text-sm" style={{ color: "var(--muted)" }}>
          Judul
        </label>
        <input
          id="title"
          name="title"
          required
          maxLength={120}
          defaultValue={initial?.title ?? ""}
          className={inputCls}
          style={inputStyle}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="text-sm" style={{ color: "var(--muted)" }}>
          Deskripsi (opsional)
        </label>
        <textarea
          id="description"
          name="description"
          rows={2}
          defaultValue={initial?.description ?? ""}
          className="w-full rounded-lg border px-3 py-2 text-base outline-none"
          style={inputStyle}
        />
      </div>

      {!initial?.issueId ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="projectId" className="text-sm" style={{ color: "var(--muted)" }}>
            Project
          </label>
          <select
            id="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={inputCls}
            style={inputStyle}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="categoryId" className="text-sm" style={{ color: "var(--muted)" }}>
            Kategori
          </label>
          <select
            id="categoryId"
            name="categoryId"
            required
            defaultValue={initial?.categoryId ?? categories[0]?.id ?? ""}
            className={inputCls}
            style={inputStyle}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="severity" className="text-sm" style={{ color: "var(--muted)" }}>
            Severity
          </label>
          <select
            id="severity"
            name="severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className={inputCls}
            style={inputStyle}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {severityLabel[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="nextStep" className="text-sm" style={{ color: "var(--muted)" }}>
          Next step / action plan
        </label>
        <textarea
          id="nextStep"
          name="nextStep"
          rows={2}
          required
          defaultValue={initial?.nextStep ?? ""}
          className="w-full rounded-lg border px-3 py-2 text-base outline-none"
          style={inputStyle}
        />
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm" style={{ color: "var(--muted)" }}>
          PIC (opsional)
        </legend>
        <div className="flex gap-3">
          <label className="flex min-h-[36px] items-center gap-2 text-sm">
            <input
              type="radio"
              name="picMode"
              checked={picMode === "user"}
              onChange={() => setPicMode("user")}
              className="h-4 w-4"
            />
            User project
          </label>
          <label className="flex min-h-[36px] items-center gap-2 text-sm">
            <input
              type="radio"
              name="picMode"
              checked={picMode === "external"}
              onChange={() => setPicMode("external")}
              className="h-4 w-4"
            />
            Vendor luar
          </label>
        </div>

        {picMode === "user" ? (
          <select
            aria-label="PIC user"
            name="picUserId"
            defaultValue={initial?.picUserId ?? ""}
            className={inputCls}
            style={inputStyle}
          >
            <option value="">— tanpa PIC —</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="PIC eksternal"
            name="picExternal"
            defaultValue={initial?.picExternal ?? ""}
            placeholder="mis. Vendor ABC"
            className={inputCls}
            style={inputStyle}
          />
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="dueAt" className="text-sm" style={{ color: "var(--muted)" }}>
          Target selesai (opsional)
        </label>
        <input
          id="dueAt"
          name="dueAt"
          type="datetime-local"
          defaultValue={initial?.dueAt ?? ""}
          className={inputCls}
          style={inputStyle}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="issue-photo" className="text-sm" style={{ color: "var(--muted)" }}>
          Foto {initial?.issueId ? "(tambah)" : "(wajib minimal 1)"}
        </label>
        <input
          id="issue-photo"
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            for (const f of files) void uploadPhoto(f);
            e.target.value = "";
          }}
          className="block w-full text-xs"
        />

        {existingPhotos.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {existingPhotos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={`/api/photos/${p.id}?v=thumb`}
                alt="Foto terlampir"
                className="h-14 w-14 rounded object-cover"
              />
            ))}
          </div>
        ) : null}

        <p className="text-xs" style={{ color: "var(--muted)" }}>
          {uploading > 0 ? `Mengupload ${uploading} foto…` : ""}
          {totalPhotos > 0 ? `${totalPhotos} foto terlampir` : ""}
        </p>
        {uploadError ? (
          <p className="text-xs" style={{ color: "#dc2626" }}>
            {uploadError}
          </p>
        ) : null}
      </div>

      {state.error ? (
        <p role="alert" className="text-sm" style={{ color: "#dc2626" }}>
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || uploading > 0}
        className="min-h-tap rounded-lg px-4 py-3 text-base font-medium text-white disabled:opacity-60"
        style={{ background: "var(--accent-solid)" }}
      >
        {pending ? "Menyimpan…" : submitLabel}
      </button>
    </form>
  );
}
