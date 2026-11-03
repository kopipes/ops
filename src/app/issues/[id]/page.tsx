import Link from "next/link";
import { PhotoGallery } from "@/components/reports/PhotoGallery";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { Pill, SEVERITY_TONE, STATUS_TONE } from "@/components/issues/IssueBadges";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { getIssueDetail, listIssuePhotos } from "@/server/services/issues";
import { severityLabel, issueStatusLabel, ISSUE_STATUSES } from "@/lib/schemas";
import {
  addIssueCommentAction,
  changeIssueStatusAction,
  softDeleteIssueAction,
} from "@/app/issue-actions";

const ACTION_LABEL: Record<string, string> = {
  created: "membuat issue",
  edited: "mengubah detail issue",
  status_changed: "mengubah status",
  comment: "berkomentar",
  photo_added: "menambah foto",
  reassigned: "mengganti PIC",
  reopened: "membuka kembali issue",
};

const FIELD_LABEL: Record<string, string> = {
  title: "Judul",
  description: "Deskripsi",
  category_id: "Kategori",
  severity: "Severity",
  next_step: "Next step",
  pic_user_id: "PIC",
  pic_external: "PIC",
  due_at: "Target selesai",
  status: "Status",
};

function fmtChange(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    // Timestamps are stored in ms; render anything plausible as a date.
    if (value > 1_000_000_000_000) return new Date(value).toLocaleString("id-ID");
  }
  return String(value);
}

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireUser();
  const { id } = await params;
  const db = getDb();

  const detail = await getIssueDetail(db, session.user, id);
  if (!detail) notFound();

  const issue = detail.issue;
  const photos = await listIssuePhotos(db, id);

  const nextStatuses = ISSUE_STATUSES.filter((s) => s !== issue.status).filter((s) =>
    // §2.3: crew may not set Closed / reopen.
    detail.canClose ? true : s !== "closed" && !(issue.status === "closed" && s === "open"),
  );

  return (
    <AppShell>
      <header className="mb-4">
        <Link href="/issues" className="text-xs" style={{ color: "var(--muted)" }}>
          ← Issues
        </Link>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          {issue.code} · {issue.projectName}
          {issue.dayDate ? ` · ${issue.dayDate}` : ""}
          {issue.phase ? ` · ${issue.phase}` : ""}
        </p>
        <h1 className="mt-0.5 text-xl font-semibold">{issue.title}</h1>

        <div className="mt-2 flex flex-wrap items-center gap-1">
          <Pill label={severityLabel[issue.severity]} tone={SEVERITY_TONE[issue.severity]} />
          <Pill label={issueStatusLabel[issue.status]} tone={STATUS_TONE[issue.status]} />
          {issue.categoryName ? <Pill label={issue.categoryName} tone={STATUS_TONE.closed} /> : null}
        </div>

        {/* §4.7: creator identity always visible with name, role, division, time. */}
        <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
          Diposting oleh {issue.authorName} · {issue.authorRole}
          {issue.authorDivision ? ` · Divisi ${issue.authorDivision}` : ""} ·{" "}
          {new Date(issue.createdAt).toLocaleString("id-ID")}
        </p>
      </header>

      {issue.deletedAt ? (
        <p
          role="status"
          className="mb-3 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "#dc2626", color: "#dc2626" }}
        >
          Dihapus — {issue.deleteReason ?? "tanpa alasan"}
        </p>
      ) : null}

      <section
        className="mb-4 rounded-xl border px-4 py-3 text-sm"
        style={{ borderColor: "var(--border)", background: "var(--surface)" }}
      >
        {issue.description ? (
          <>
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Deskripsi
            </p>
            <p className="mb-2 whitespace-pre-wrap">{issue.description}</p>
          </>
        ) : null}

        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Next step
        </p>
        <p className="mb-2 whitespace-pre-wrap">{issue.nextStep}</p>

        <dl className="flex flex-col gap-0.5 text-xs" style={{ color: "var(--muted)" }}>
          <div className="flex justify-between gap-2">
            <dt>PIC</dt>
            <dd>{issue.picName ?? issue.picExternal ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt>Target selesai</dt>
            <dd>{issue.dueAt ? new Date(issue.dueAt).toLocaleString("id-ID") : "—"}</dd>
          </div>
        </dl>
      </section>

      {photos.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-1 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Foto ({photos.length})
          </h2>
          <PhotoGallery photos={photos.map((photo, index) => ({ id: photo.id, label: `Foto issue ${index + 1}`, caption: issue.title }))} />
        </section>
      ) : null}

      {/* §9.5 no.3: append-only timeline */}
      <section className="mb-4">
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
          Timeline ({detail.timeline.length})
        </h2>
        <ol className="flex flex-col gap-2">
          {detail.timeline.map((t) => (
            <li
              key={t.id}
              className="rounded-lg border px-3 py-2"
              style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            >
              <p className="text-xs" style={{ color: "var(--muted)" }}>
                {new Date(t.createdAt).toLocaleString("id-ID")} · {t.authorName} ({t.authorRole}
                {t.authorDivision ? `, ${t.authorDivision}` : ""})
              </p>
              <p className="text-sm">
                {ACTION_LABEL[t.action] ?? t.action}
                {t.action === "status_changed" && t.statusFrom && t.statusTo
                  ? ` ${issueStatusLabel[t.statusFrom as keyof typeof issueStatusLabel] ?? t.statusFrom} → ${
                      issueStatusLabel[t.statusTo as keyof typeof issueStatusLabel] ?? t.statusTo
                    }`
                  : ""}
              </p>

              {t.changes && Object.keys(t.changes).length > 0 && t.action !== "status_changed" ? (
                <ul className="mt-1 flex flex-col gap-0.5 text-xs" style={{ color: "var(--muted)" }}>
                  {Object.entries(t.changes)
                    .filter(([, pair]) => String(pair[0] ?? "") !== String(pair[1] ?? ""))
                    .map(([field, pair]) => (
                      <li key={field}>
                        {FIELD_LABEL[field] ?? field}: {fmtChange(pair[0])} → {fmtChange(pair[1])}
                      </li>
                    ))}
                </ul>
              ) : null}

              {t.note ? (
                <p className="mt-1 text-sm whitespace-pre-wrap" style={{ color: "var(--fg)" }}>
                  “{t.note}”
                </p>
              ) : null}

              <PhotoGallery small photos={t.photos.map((photo, index) => ({ id: photo.id, label: `Foto update ${index + 1}`, caption: t.note ?? undefined }))} />
            </li>
          ))}
        </ol>
      </section>

      {detail.canEdit && !issue.deletedAt ? (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
            Ubah status
          </h2>
          <form action={changeIssueStatusAction} className="flex flex-col gap-2">
            <input type="hidden" name="issueId" value={id} />
            <select
              name="status"
              aria-label="Status baru"
              className="min-h-tap rounded-lg border px-3 text-sm"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
            >
              {nextStatuses.map((s) => (
                <option key={s} value={s}>
                  {issueStatusLabel[s]}
                </option>
              ))}
            </select>
            <input
              name="note"
              placeholder="Catatan (opsional)"
              aria-label="Catatan perubahan status"
              className="min-h-tap rounded-lg border px-3 text-sm"
              style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
            />
            <button
              type="submit"
              className="min-h-tap rounded-lg px-4 py-2 text-sm font-medium text-white"
              style={{ background: "var(--accent)" }}
            >
              Simpan status
            </button>
          </form>
        </section>
      ) : null}

      <section className="mb-4">
        <h2 className="mb-2 text-sm font-medium" style={{ color: "var(--muted)" }}>
          Tambah komentar
        </h2>
        <form action={addIssueCommentAction} className="flex flex-col gap-2">
          <input type="hidden" name="issueId" value={id} />
          <textarea
            name="note"
            required
            rows={2}
            aria-label="Komentar"
            className="w-full rounded-lg border px-3 py-2 text-base"
            style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
          />
          <button
            type="submit"
            className="min-h-tap rounded-lg px-4 py-2 text-sm font-medium text-white"
            style={{ background: "var(--accent)" }}
          >
            Kirim komentar
          </button>
        </form>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Lampiran foto pada komentar tersedia di iterasi berikutnya.
        </p>
      </section>

      {detail.canClose && !issue.deletedAt ? (
        <section>
          <details>
            <summary className="cursor-pointer text-xs" style={{ color: "var(--muted)" }}>
              Hapus issue (soft delete)
            </summary>
            <form action={softDeleteIssueAction} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="issueId" value={id} />
              <input
                name="reason"
                required
                placeholder="Alasan penghapusan (wajib)"
                aria-label="Alasan penghapusan"
                className="min-h-tap rounded-lg border px-3 text-sm"
                style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--fg)" }}
              />
              <button
                type="submit"
                className="min-h-tap rounded-lg border px-4 py-2 text-sm"
                style={{ borderColor: "var(--border)", color: "#dc2626" }}
              >
                Hapus
              </button>
            </form>
          </details>
        </section>
      ) : null}
    </AppShell>
  );
}
