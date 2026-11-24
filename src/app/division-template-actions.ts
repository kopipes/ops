"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithoutPasswordChange } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";
import { assignLegacyTemplate, editDivisionTemplate, setDivisionTemplateActive } from "@/server/services/division-templates";

function errorState(error: unknown): { error?: string } {
  if (error instanceof ForbiddenError || error instanceof ValidationError) return { error: error.message };
  console.error("[division template]", error);
  return { error: "Template gagal disimpan. Coba lagi." };
}

export async function saveDivisionTemplateAction(_prev: { error?: string }, form: FormData) {
  const { user } = await requireUserWithoutPasswordChange();
  const id = String(form.get("templateId") ?? "");
  try {
    const raw = String(form.get("rows") ?? "");
    let rows: unknown;
    try { rows = JSON.parse(raw); }
    catch { throw new ValidationError("Isi checklist tidak valid."); }
    editDivisionTemplate(getDb(), user, id, Number(form.get("version")), rows, String(form.get("name") ?? ""));
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/master/templates");
  revalidatePath("/projects/new");
  redirect(`/master/templates/${encodeURIComponent(id)}?saved=1`);
}

export async function setDivisionTemplateActiveAction(_prev: { error?: string }, form: FormData) {
  const { user } = await requireUserWithoutPasswordChange();
  const id = String(form.get("templateId") ?? "");
  const isActive = form.get("restore") === "1";
  try {
    setDivisionTemplateActive(getDb(), user, id, Number(form.get("version")), isActive);
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/master/templates");
  revalidatePath("/projects/new");
  redirect(`/master/templates/${encodeURIComponent(id)}?${isActive ? "restored" : "archived"}=1`);
}

export async function assignLegacyTemplateAction(_prev: { error?: string }, form: FormData) {
  const { user } = await requireUserWithoutPasswordChange();
  let id: string;
  try {
    id = assignLegacyTemplate(getDb(), user, String(form.get("templateId") ?? ""), String(form.get("divisionId") ?? ""), String(form.get("name") ?? "").trim());
  } catch (error) {
    return errorState(error);
  }
  revalidatePath("/master/templates");
  revalidatePath("/projects/new");
  redirect(`/master/templates/${encodeURIComponent(id)}?created=1`);
}
