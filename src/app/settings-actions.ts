"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { saveGlobalSettings } from "@/server/services/app-settings";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";

export interface SettingsActionState {
  ok?: boolean;
  error?: string;
}

export async function saveSettingsAction(
  _prev: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> {
  const session = await requireUser();

  try {
    await saveGlobalSettings(getDb(), session.user, {
      openingWindowEnabled: formData.get("openingWindowEnabled") === "on",
      closingWindowEnabled: formData.get("closingWindowEnabled") === "on",
      defaultOpeningWindowStart: String(formData.get("defaultOpeningWindowStart") ?? ""),
      defaultOpeningWindowEnd: String(formData.get("defaultOpeningWindowEnd") ?? ""),
      defaultClosingWindowStart: String(formData.get("defaultClosingWindowStart") ?? ""),
      defaultClosingWindowEnd: String(formData.get("defaultClosingWindowEnd") ?? ""),
      defaultTimezone: String(formData.get("defaultTimezone") ?? ""),
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof ValidationError) return { error: err.message };
    console.error("[settings]", err);
    return { error: "Terjadi kesalahan. Coba lagi." };
  }
}
