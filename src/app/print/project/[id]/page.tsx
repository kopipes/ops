/**
 * Project recap print view (§7.5) — one project over a date range (max 31 days).
 *
 * Each day renders as its own section with `page-break-inside: avoid`, so a day
 * never splits awkwardly across pages.
 */
import { notFound } from "next/navigation";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/server/db";
import { projectDays, projects } from "@/server/db/schema";
import { currentSession } from "@/server/auth/current-user";
import { getDayDetail } from "@/server/services/reports-review";
import { canExportPdf } from "@/server/permissions";
import { loadFacts } from "@/server/services/projects";
import { dateRange } from "@/lib/datetime";
import { MAX_RECAP_DAYS } from "@/server/pdf/render";
import {
  formatDateTime,
  formatTime,
  parsePrintOptions,
  phaseLabel,
  printCss,
} from "@/lib/print/shared";

export const metadata = { title: "Print Rekap — Ops" };

const RESULT_PILL: Record<string, { cls: string; label: string }> = {
  ok: { cls: "pill-ok", label: "OK" },
  not_ok: { cls: "pill-notok", label: "Tidak OK" },
  na: { cls: "pill-na", label: "N/A" },
};

export default async function PrintRecapPage({
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
  const project = await db.select().from(projects).where(eq(projects.id, id)).get();
  if (!project) notFound();

  const facts = await loadFacts(db, id);
  if (!canExportPdf(session.user, facts)) notFound();

  const from = sp.from ?? project.startDate;
  const to = sp.to ?? project.endDate;
  const allDates = dateRange(from, to);
  if (allDates.length === 0) notFound();

  // §7.5 cap: never render more than the allowed window.
  const dates = allDates.slice(0, MAX_RECAP_DAYS);

  const dayRows = await db
    .select({ id: projectDays.id, date: projectDays.date })
    .from(projectDays)
    .where(and(eq(projectDays.projectId, id), gte(projectDays.date, from), lte(projectDays.date, to)))
    .orderBy(asc(projectDays.date));

  // Load every day's detail; bounded by the 31-day cap.
  const details = [];
  for (const d of dayRows) {
    const detail = await getDayDetail(db, session.user, id, d.date);
    if (detail) details.push(detail);
  }

  const totalPhotos = details.reduce((n, d) => n + d.summary.photoCount, 0);
  const reviewedCount = details.filter((d) => d.day.reviewedAt !== null).length;

  return (
    <div className="print-root">
      <style dangerouslySetInnerHTML={{ __html: printCss }} />
        <div className="header">
          <div>
            <div className="logo">PROVALIANT</div>
            <h1>{project.name}</h1>
            <div className="meta">
              {project.client ? `Klien: ${project.client} · ` : ""}
              {project.venue}
            </div>
            <div className="meta">
              Rekap {from} s/d {to} · Kode: {project.code}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="meta">Rekap Project</div>
            <div className="meta">{details.length} hari</div>
          </div>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="k">Hari dilaporkan</div>
            <div className="v">{details.length}</div>
          </div>
          <div className="stat">
            <div className="k">Hari direview</div>
            <div className="v">{reviewedCount}</div>
          </div>
          <div className="stat">
            <div className="k">Total issue</div>
            <div className="v">{details.reduce((n, d) => n + d.issues.length, 0)}</div>
          </div>
          <div className="stat">
            <div className="k">Foto</div>
            <div className="v">{opts.includePhotos ? totalPhotos : "—"}</div>
          </div>
        </div>

        {opts.clientMode ? (
          <div className="muted" style={{ fontSize: 9, marginBottom: 8 }}>
            Mode klien: komentar internal dan catatan audit tidak ditampilkan.
          </div>
        ) : null}

        {dates.length < allDates.length ? (
          <div className="block warn">
            Rentang dipotong ke {MAX_RECAP_DAYS} hari pertama karena batas maksimum per PDF.
          </div>
        ) : null}

        {details.map((d) => (
          <div key={d.day.id} className="day">
            <h2>
              {d.day.date}
              {d.day.dayType !== "event" ? ` · ${d.day.dayType}` : ""}
            </h2>

            <div className="muted" style={{ marginBottom: 4 }}>
              Checklist OK:{" "}
              {d.summary.checklistOkPct === null ? "—" : `${d.summary.checklistOkPct}%`} · NOT OK:{" "}
              {d.summary.notOkCount} · Monitoring: {d.summary.monitoringCount} · Issue terbuka:{" "}
              {d.summary.issuesOpen} ·{" "}
              {d.day.reviewedAt ? (
                <span className="reviewed">direview</span>
              ) : (
                <span className="not-reviewed">belum direview</span>
              )}
            </div>

            {(["opening", "closing"] as const).map((phase) => {
              const block = phase === "opening" ? d.opening : d.closing;
              return (
                <div key={phase} style={{ marginBottom: 6 }}>
                  <h3 style={{ margin: "4px 0 2px" }}>{phaseLabel(phase)}</h3>
                  {!block ? (
                    <div className="bad" style={{ fontSize: 10 }}>
                      Tidak diisi
                    </div>
                  ) : (
                    <>
                      <div className="muted" style={{ fontSize: 9 }}>
                        {block.submittedByName ?? "—"} · {formatTime(block.submittedAt, d.project.timezone)}
                        {block.isLate ? " · TERLAMBAT" : ""}
                      </div>
                      {block.phaseNote ? (
                        <div style={{ fontSize: 10, marginTop: 1 }}>
                          <strong>
                            {phase === "closing" ? "Laporan Akhir Hari:" : "Laporan Awal Hari:"}
                          </strong>{" "}
                          {block.phaseNote}
                        </div>
                      ) : null}
                      {block.notes ? <div style={{ fontSize: 10 }}>{block.notes}</div> : null}
                      <ul style={{ fontSize: 10 }}>
                        {[...block.results]
                          .sort((a, b) => {
                            const rank = { not_ok: 0, na: 1, ok: 2 } as Record<string, number>;
                            return (rank[a.result] ?? 9) - (rank[b.result] ?? 9);
                          })
                          .filter((r) => r.result !== "ok")
                          .map((r) => (
                            <li key={r.id} className={r.result === "not_ok" ? "bad" : undefined}>
                              <span className={`pill ${RESULT_PILL[r.result].cls}`}>
                                {RESULT_PILL[r.result].label}
                              </span>{" "}
                              {r.label}
                              {r.note ? ` — ${r.note}` : ""}
                            </li>
                          ))}
                      </ul>
                      {block.results.filter((r) => r.result === "ok").length > 0 ? (
                        <div className="muted" style={{ fontSize: 9 }}>
                          {block.results.filter((r) => r.result === "ok").length} item OK
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              );
            })}

            {d.monitoring.length > 0 ? (
              <>
                <h3 style={{ margin: "4px 0 2px" }}>Monitoring</h3>
                <ul style={{ fontSize: 10 }}>
                  {d.monitoring.map((m) => (
                    <li key={m.reportId}>
                      {formatTime(m.submittedAt, d.project.timezone)} — {m.notes}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {d.issues.length > 0 ? (
              <table style={{ marginTop: 4 }}>
                <thead>
                  <tr>
                    <th>Kode</th>
                    <th>Judul</th>
                    <th>Severity</th>
                    <th>Status</th>
                    <th>Next step</th>
                    <th>PIC</th>
                  </tr>
                </thead>
                <tbody>
                  {d.issues.map((i) => (
                    <tr key={i.id}>
                      <td>{i.code}</td>
                      <td>{i.title}</td>
                      <td className={i.severity === "critical" || i.severity === "high" ? "bad" : undefined}>
                        {i.severity}
                      </td>
                      <td>{i.status}</td>
                      <td>{i.nextStep}</td>
                      <td>{i.picName ?? i.picExternal ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}

            {opts.includePhotos && d.gallery.length > 0 ? (
              <div className="photos" style={{ marginTop: 4 }}>
                {d.gallery.slice(0, 9).map((p) => (
                  <div key={p.id} className="photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/photos/${p.id}?v=main`} alt="Foto" />
                    <div className="cap">
                      {p.phase ? phaseLabel(p.phase) : "—"} · {formatTime(p.createdAt, d.project.timezone)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {!opts.clientMode && d.comments.length > 0 ? (
              <div style={{ fontSize: 9, marginTop: 4 }} className="muted">
                Komentar review:{" "}
                {d.comments
                  .map((c) => `${c.authorName} (${formatDateTime(c.createdAt, d.project.timezone)}): ${c.body}`)
                  .join(" · ")}
              </div>
            ) : null}
          </div>
        ))}

        {details.length === 0 ? (
          <div className="block muted">Tidak ada data pada rentang ini.</div>
        ) : null}
    </div>
  );
}
