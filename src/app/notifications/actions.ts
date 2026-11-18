"use server";
import {revalidatePath} from "next/cache";
import {requireUser} from "@/server/auth/current-user";
import {getDb} from "@/server/db";
import {openAnyReviewNotification} from "@/server/services/all-review-notifications";
import {ValidationError} from "@/server/services/checklist-items";
export async function openNotificationAction(data:FormData):Promise<{href?:string;error?:string}> {
  const session=await requireUser();
  try {
    const href=openAnyReviewNotification(getDb(),session.user,String(data.get("notificationId")??""),String(data.get("kind")??"point"));
    revalidatePath("/", "layout");return {href};
  }catch(err){if(err instanceof ValidationError)return {error:err.message};throw err;}
}
