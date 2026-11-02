"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { addDayComment, markDayReviewed, unmarkDayReviewed } from "@/server/services/reports-review";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";

export interface ReviewActionState {
  ok?: boolean;
  error?: string;
}

function toError(err: unknown): ReviewActionState {
  if (err instanceof ForbiddenError || err instanceof ValidationError) return { error: err.message };
  console.error("[review action]", err);
  return { error: "Terjadi kesalahan. Coba lagi." };
}

export async function markReviewedAction(formData: FormData): Promise<void> {
  const session = await requireUser();
  const projectDayId = String(formData.get("projectDayId") ?? "");
  if (!projectDayId) return;

  try {
    await markDayReviewed(getDb(), session.user, projectDayId);
    revalidatePath("/reports");
    revalidatePath(`/reports/day/${projectDayId}`);
  } catch (err) {
    console.error("[mark reviewed]", toError(err));
  }
}

export async function unmarkReviewedAction(formData: FormData): Promise<void> {
  const session = await requireUser();
  const projectDayId = String(formData.get("projectDayId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!projectDayId) return;

  try {
    await unmarkDayReviewed(getDb(), session.user, projectDayId, reason);
    revalidatePath("/reports");
    revalidatePath(`/reports/day/${projectDayId}`);
  } catch (err) {
    console.error("[unmark reviewed]", toError(err));
  }
}

export async function dayCommentAction(
  _prev: ReviewActionState,
  formData: FormData,
): Promise<ReviewActionState> {
  const session = await requireUser();
  const projectDayId = String(formData.get("projectDayId") ?? "");
  const body = String(formData.get("body") ?? "");
  if (!projectDayId) return { error: "Hari tidak valid" };

  try {
    await addDayComment(getDb(), session.user, projectDayId, body);
    revalidatePath(`/reports/day/${projectDayId}`);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}
