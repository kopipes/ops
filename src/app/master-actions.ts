"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { requireUserWithoutPasswordChange } from "@/server/auth/current-user";
import { issueCategoryInputSchema } from "@/lib/schemas";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";
import { createIssueCategory, deactivateIssueCategory, updateIssueCategory } from "@/server/services/categories";

export interface ActionState {
  ok?: boolean;
  error?: string;
  createdId?: string;
}

/**
 * Every action resolves the acting user server-side and never trusts a role
 * sent from the client (§9.3). Errors are mapped to friendly messages so a
 * crafted request cannot distinguish "forbidden" from "not found" details.
 */
async function acting() {
  const session = await requireUserWithoutPasswordChange();
  return session.user;
}

function toError(err: unknown): ActionState {
  if (err instanceof ForbiddenError) return { error: err.message };
  if (err instanceof ValidationError) return { error: err.message };
  console.error("[master-data action]", err);
  return { error: "Terjadi kesalahan. Coba lagi." };
}

const revalidateMaster = () => {
  revalidatePath("/master/issue-categories");
};

export async function saveIssueCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await acting();
  const parsed = issueCategoryInputSchema.safeParse({
    name: formData.get("name"),
    sortOrder: formData.get("sortOrder") ?? 0,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };

  const id = String(formData.get("id") ?? "").trim();
  try {
    const db = getDb();
    if (id) await updateIssueCategory(db, user, id, parsed.data);
    else await createIssueCategory(db, user, parsed.data);
    revalidateMaster();
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function deactivateIssueCategoryAction(formData: FormData): Promise<void> {
  const user = await acting();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await deactivateIssueCategory(getDb(), user, id);
    revalidateMaster();
  } catch (err) {
    console.error("[deactivate issue category]", toError(err));
  }
}
