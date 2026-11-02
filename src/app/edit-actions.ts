"use server";

import { revalidatePath } from "next/cache";
import { getDb, getRawDb } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { applyReportEdit } from "@/server/services/report-edits";
import type { CheckResultInput } from "@/server/services/reports";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";

export interface EditReportState {
  ok?: boolean;
  error?: string;
}

export async function editReportAction(
  _prev: EditReportState,
  formData: FormData,
): Promise<EditReportState> {
  const session = await requireUser();
  const reportId = String(formData.get("reportId") ?? "");
  if (!reportId) return { error: "Laporan tidak valid" };

  const results: CheckResultInput[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("r_") || typeof value !== "string" || value === "") continue;
    const itemId = key.slice(2);
    if (!["ok", "not_ok", "na"].includes(value)) continue;
    const note = String(formData.get(`note_${itemId}`) ?? "").trim();
    results.push({
      projectChecklistItemId: itemId,
      result: value as "ok" | "not_ok" | "na",
      note: note === "" ? null : note,
      photoIds: [],
    });
  }

  const notesRaw = String(formData.get("notes") ?? "").trim();

  try {
    await applyReportEdit(getDb(), getRawDb(), session.user, reportId, {
      notes: notesRaw === "" ? null : notesRaw,
      results,
    });
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof ValidationError) {
      return { error: err.message };
    }
    console.error("[report edit]", err);
    return { error: "Terjadi kesalahan. Coba lagi." };
  }

  revalidatePath(`/reports`);
  revalidatePath(`/reports/edit/${reportId}`);
  return { ok: true };
}
