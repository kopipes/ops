"use server";

import { eq } from "drizzle-orm";
import { getDb, getRawDb } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { projects, reports } from "@/server/db/schema";
import { submitReport, type CheckResultInput, type Phase } from "@/server/services/reports";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";

export interface ReportFormActionState {
  ok?: boolean;
  error?: string;
  redirectTo?: string;
}

function toError(err: unknown): ReportFormActionState {
  if (err instanceof ForbiddenError || err instanceof ValidationError) return { error: err.message };
  console.error("[report action]", err);
  return { error: "Terjadi kesalahan saat menyimpan. Coba lagi." };
}

/**
 * Parses the dynamic per-item fields emitted by ReportForm.
 * Item ids are not sent as a list; the service re-derives the authoritative
 * checklist from the database for the given phase, so a tampered form cannot
 * invent items.
 */
function parseResults(formData: FormData): CheckResultInput[] {
  const results: CheckResultInput[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("r_") || typeof value !== "string" || value === "") continue;
    const itemId = key.slice(2);
    const result = value as "ok" | "not_ok" | "na";
    if (!["ok", "not_ok", "na"].includes(result)) continue;

    const note = String(formData.get(`note_${itemId}`) ?? "").trim();
    const photoIds = formData.getAll(`photos_${itemId}`).map(String).filter(Boolean);

    results.push({
      projectChecklistItemId: itemId,
      result,
      note: note === "" ? null : note,
      photoIds,
    });
  }
  return results;
}

export async function submitReportAction(
  _prev: ReportFormActionState,
  formData: FormData,
): Promise<ReportFormActionState> {
  const session = await requireUser();

  const projectId = String(formData.get("projectId") ?? "");
  const projectDayId = String(formData.get("projectDayId") ?? "");
  const phase = String(formData.get("phase") ?? "") as Phase;
  const clientSubmissionId = String(formData.get("clientSubmissionId") ?? "");

  if (!projectId || !projectDayId || !clientSubmissionId) {
    return { error: "Data form tidak lengkap." };
  }
  if (!["opening", "monitoring", "closing"].includes(phase)) {
    return { error: "Fase tidak valid." };
  }

  const notes = String(formData.get("notes") ?? "").trim();
  if (phase === "monitoring" && notes === "") {
    return { error: "Catatan observasi wajib diisi untuk laporan monitoring." };
  }

  const observedAtRaw = Number(formData.get("observedAt"));
  const observedAt = Number.isFinite(observedAtRaw) && observedAtRaw > 0 ? observedAtRaw : Date.now();

  const lat = String(formData.get("latitude") ?? "").trim();
  const lng = String(formData.get("longitude") ?? "").trim();
  const accRaw = Number(formData.get("locationAccuracyM"));

  const phaseNoteRaw = String(formData.get("phaseNote") ?? "").trim();
  const phaseNote = phase === "monitoring" ? null : phaseNoteRaw === "" ? null : phaseNoteRaw;

  const handoverRaw = formData.get("handoverNote");
  const handoverNote = typeof handoverRaw === "string" ? handoverRaw.trim() : undefined;

  try {
    const db = getDb();
    const raw = getRawDb();

    const outcome = await submitReport(db, raw, session.user, {
      projectId,
      projectDayId,
      phase,
      clientSubmissionId,
      notes: notes === "" ? null : notes,
      phaseNote,
      observedAt,
      results: parseResults(formData),
      photoIds: formData.getAll("generalPhotos").map(String).filter(Boolean),
      handoverNote: phase === "closing" ? (handoverNote ?? "") : undefined,
      latitude: lat === "" ? null : lat,
      longitude: lng === "" ? null : lng,
      locationAccuracyM: Number.isFinite(accRaw) && accRaw > 0 ? Math.round(accRaw) : null,
    });

    if (!outcome.ok) return { error: outcome.message };

    // Land back on the project day page so the crew sees the result.
    const project = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get();

    return {
      ok: true,
      redirectTo: project ? `/projects/${project.id}?tab=today&submitted=${outcome.reportId}` : "/",
    };
  } catch (err) {
    return toError(err);
  }
}

/** Used by the "Lihat / Edit" button (§4.6). */
export async function canEditReportAction(reportId: string): Promise<boolean> {
  const session = await requireUser();
  const db = getDb();
  const row = await db
    .select({ submittedBy: reports.submittedBy })
    .from(reports)
    .where(eq(reports.id, reportId))
    .get();
  if (!row) return false;
  return row.submittedBy === session.user.id || session.user.role === "admin";
}
