"use server";
import {revalidatePath} from "next/cache";
import {requireUser} from "@/server/auth/current-user";
import {getDb} from "@/server/db";
import {openReviewNotification} from "@/server/services/checklist-reviews";
import {ValidationError} from "@/server/services/checklist-items";
export async function openNotificationAction(data:FormData):Promise<{href?:string;error?:string}> {
  const session=await requireUser();
  try {
    const href=openReviewNotification(getDb(),session.user,String(data.get("notificationId")??""));
    revalidatePath("/", "layout");return {href};
  }catch(err){if(err instanceof ValidationError)return {error:err.message};throw err;}
}
