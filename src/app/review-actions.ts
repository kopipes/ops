"use server";

import {redirect} from "next/navigation";
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
    await markDayReviewed(getDb(), session.user, projectDayId, String(formData.get("reviewVersion")??""));
    revalidatePath("/reports");
    revalidatePath(`/reports/day/${projectDayId}`);
  } catch (err) {
    if(err instanceof ValidationError)redirect(`/reports/day/${encodeURIComponent(projectDayId)}?reviewError=changed`);
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

export async function pointReviewAction(_prev:ReviewActionState,formData:FormData):Promise<ReviewActionState> {
  const session=await requireUser();
  const {addPointReview}=await import("@/server/services/checklist-reviews");
  try {
    const {addPhotoReview}=await import("@/server/services/photo-reviews");
    const common={id:String(formData.get("id")??""),verdict:String(formData.get("verdict")??""),action:String(formData.get("action")??""),note:String(formData.get("note")??""),contentHash:String(formData.get("contentHash")??"")};
    const result=formData.has("photoId") ? addPhotoReview(getDb(),session.user,{...common,photoId:String(formData.get("photoId")??"")}) : addPointReview(getDb(),session.user,{
      id:String(formData.get("id")??""),checkResultId:String(formData.get("checkResultId")??""),
      verdict:String(formData.get("verdict")??""),action:String(formData.get("action")??""),note:String(formData.get("note")??""),contentHash:String(formData.get("contentHash")??""),
    });
    revalidatePath(`/reports/day/${result.projectDayId}`);revalidatePath("/", "layout");
    return {ok:true};
  }catch(err){return toError(err);}
}
