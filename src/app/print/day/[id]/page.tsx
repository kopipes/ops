/**
 * Daily report print view (§7.5).
 *
 * Rendered by headless Chromium into the "PDF laporan harian".
 * Authenticated like any other page: a session AND project visibility are
 * required, so the URL alone is never enough.
 */
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { projectDays } from "@/server/db/schema";
import { currentSession } from "@/server/auth/current-user";
import { getDayDetail } from "@/server/services/reports-review";
import { canExportPdf } from "@/server/permissions";
import { loadFacts } from "@/server/services/projects";
import {
  formatDateTime,
  formatTime,
  parsePrintOptions,
  phaseLabel,
  printCss,
} from "@/lib/print/shared";

export const metadata = { title: "Print — Pulse" };

const RESULT_PILL: Record<string, { cls: string; label: string }> = {
  ok: { cls: "pill-ok", label: "OK" },
  not_ok: { cls: "pill-notok", label: "Tidak OK" },
  na: { cls: "pill-na", label: "N/A" },
};

export default async function PrintDayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await currentSession();
  if (!session) notFound();

  const { id } = await params;
  const sp = await searchParams;
  const opts = parsePrintOptions(new URLSearchParams(sp as Record<string, string>));

  const db = getDb();
  const day = await db.select().from(projectDays).where(eq(projectDays.id, id)).get();
  if (!day) notFound();

  const facts = await loadFacts(db, day.projectId);
  // §2.3: only admin/corporate/manager may export.
  if (!canExportPdf(session.user, facts)) notFound();

  const detail = await getDayDetail(db, session.user, day.projectId, day.date);
  if (!detail) notFound();

  const tz = detail.project.timezone;

  return (
    <div className="print-root">
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
        <div className="header">
          <div>
            <div className="logo">PROVALIANT</div>
            <h1>{detail.project.name}</h1>
            <div className="meta">
              {detail.project.client ? `Klien: ${detail.project.client} · ` : ""}
              {detail.project.venue}
            </div>
            <div className="meta">
              Tanggal: {detail.day.date} · Kode: {detail.project.code}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="meta">Laporan Harian</div>
            <div className="meta">{detail.day.dayType}</div>
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="k">Checklist OK</div>
            <div className="v">
              {detail.summary.checklistOkPct === null ? "—" : `${detail.summary.checklistOkPct}%`}
            </div>
          </div>
          <div className="stat">
            <div className="k">Item NOT OK</div>
            <div className="v bad">{detail.summary.notOkCount}</div>
          </div>
          <div className="stat">
            <div className="k">Monitoring</div>
            <div className="v">{detail.summary.monitoringCount}</div>
          </div>
          <div className="stat">
            <div className="k">Foto</div>
            <div className="v">{opts.includePhotos ? detail.summary.photoCount : "—"}</div>
          </div>
        </div>

        {detail.handoverFromPrevious ? (
          <div className="block">
            <strong>Catatan handover hari sebelumnya</strong>
            <div className="muted">{detail.handoverFromPrevious}</div>
          </div>
        ) : null}

        {/* Opening & closing checklists, NOT_OK first (§7.5) */}
        {(["opening", "closing"] as const).map((phase) => {
          const block = phase === "opening" ? detail.opening : detail.closing;
          if (!block) {
            return (
              <div key={phase}>
                <h2>{phaseLabel(phase)}</h2>
                <div className="block muted">Belum diisi</div>
              </div>
            );
          }
          const sorted = [...block.results].sort((a, b) => {
            const rank = { not_ok: 0, na: 1, ok: 2 } as Record<string, number>;
            return (rank[a.result] ?? 9) - (rank[b.result] ?? 9);
          });

          return (
            <div key={phase}>
              <h2>{phaseLabel(phase)}</h2>
              <div className="block">
                <div className="muted" style={{ marginBottom: 4 }}>
                  Diisi oleh {block.submittedByName ?? "—"} · Waktu pengisian: {formatDateTime(block.submittedAt, tz)}
                  {block.editLabel ? ` · Diedit oleh ${block.editLabel.editedByName ?? "—"}, ${formatDateTime(block.editLabel.editedAt, tz)}` : ""}
                  {block.isLate ? " · TERLAMBAT" : ""}
                  {block.latitude
                    ? ` · lokasi ${block.latitude},${block.longitude}`
                    : ""}
                </div>
                {block.phaseNote ? (
                  <div
                    style={{
                      marginBottom: 5,
                      padding: "4px 6px",
                      borderLeft: "3px solid #1d4ed8",
                      background: "#f8fafc",
                    }}
                  >
                    <strong style={{ fontSize: 10 }}>
                      {phase === "closing" ? "Laporan Akhir Hari" : "Laporan Awal Hari"}
                    </strong>
                    <div style={{ whiteSpace: "pre-wrap" }}>{block.phaseNote}</div>
                  </div>
                ) : null}
                {block.notes ? <div style={{ marginBottom: 4 }}>{block.notes}</div> : null}
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "38%" }}>Item</th>
                      <th style={{ width: "14%" }}>Kategori</th>
                      <th style={{ width: "12%" }}>Hasil</th>
                      <th>Catatan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.id} className={r.result === "not_ok" ? "notok-row" : undefined}>
                        <td>{r.label}</td>
                        <td>{r.categoryName}</td>
                        <td>
                          <span className={`pill ${RESULT_PILL[r.result].cls}`}>
                            {RESULT_PILL[r.result].label}
                          </span>
                        </td>
                        <td>{r.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {/* Monitoring entries */}
        {detail.monitoring.length > 0 ? (
          <>
            <h2>Monitoring ({detail.monitoring.length})</h2>
            {detail.monitoring.map((m) => (
              <div key={m.reportId} className="block">
                <div className="muted">
                  Diisi oleh {m.submittedByName ?? "—"} · Waktu pengisian: {formatDateTime(m.submittedAt, tz)}
                  {m.editLabel ? ` · Diedit oleh ${m.editLabel.editedByName ?? "—"}, ${formatDateTime(m.editLabel.editedAt, tz)}` : ""}
                  {m.latitude ? ` · lokasi ${m.latitude},${m.longitude}` : ""}
                </div>
                <div>{m.notes}</div>
                {m.results.filter((r) => r.result !== "ok").length > 0 ? (
                  <ul>
                    {m.results
                      .filter((r) => r.result !== "ok")
                      .map((r) => (
                        <li key={r.id}>
                          <span className="bad">
                            {RESULT_PILL[r.result].label}: {r.label}
                          </span>
                          {r.note ? ` — ${r.note}` : ""}
                        </li>
                      ))}
                  </ul>
                ) : null}
              </div>
            ))}
          </>
        ) : null}

        {/* Handover for tomorrow */}
        {detail.day.handoverNote ? (
          <div className="block">
            <strong>Catatan untuk besok (handover)</strong>
            <div>{detail.day.handoverNote}</div>
          </div>
        ) : null}

        {/* Issues (§7.5: kode, severity, status, next step, PIC, pembuat) */}
        {detail.issues.length > 0 ? (
          <>
            <h2>Issues ({detail.issues.length})</h2>
            <table>
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Judul</th>
                  <th>Severity</th>
                  <th>Status</th>
                  <th>Next step</th>
                  <th>PIC</th>
                  <th>Pembuat</th>
                </tr>
              </thead>
              <tbody>
                {detail.issues.map((i) => (
                  <tr key={i.id}>
                    <td>{i.code}</td>
                    <td>{i.title}</td>
                    <td className={i.severity === "critical" || i.severity === "high" ? "bad" : undefined}>
                      {i.severity}
                    </td>
                    <td>{i.status}</td>
                    <td>{i.nextStep}</td>
                    <td>{i.picName ?? i.picExternal ?? "—"}</td>
                    <td>
                      {i.authorName}
                      <div className="muted">
                        {i.authorRole}
                        {i.authorDivision ? ` · ${i.authorDivision}` : ""}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : null}

        {/* Photos in a 3-column grid with captions (§7.5) */}
        {opts.includePhotos && detail.gallery.length > 0 ? (
          <>
            <h2>Foto ({detail.gallery.length})</h2>
            <div className="photos">
              {detail.gallery.map((p) => (
                <div key={p.id} className="photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/photos/${p.id}?v=main`} alt="Foto" />
                  <div className="cap">
                    {p.phase ? phaseLabel(p.phase) : "—"} · {formatTime(p.createdAt, tz)}
                    {p.uploadedByName ? ` · ${p.uploadedByName}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* Review status (§7.5) */}
        <h2>Review</h2>
        <div className="block">
          {detail.day.reviewedAt ? (
            <span className="reviewed">
              Direview oleh {detail.day.reviewedByName ?? "—"} ·{" "}
              {formatDateTime(detail.day.reviewedAt, tz)}
            </span>
          ) : (
            <span className="not-reviewed">Belum direview</span>
          )}

          {/* Client mode hides internal comments (§7.5) */}
          {!opts.clientMode && detail.comments.length > 0 ? (
            <ul style={{ marginTop: 4 }}>
              {detail.comments.map((c) => (
                <li key={c.id}>
                  <strong>
                    {c.authorName} ({c.authorRole})
                  </strong>{" "}
                  · {formatDateTime(c.createdAt, tz)} — {c.body}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {!opts.includePhotos ? (
          <div className="muted" style={{ marginTop: 8, fontSize: 9 }}>
            Foto tidak disertakan pada dokumen ini.
          </div>
        ) : null}
    </div>
  );
}
