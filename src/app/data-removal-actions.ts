"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUserWithoutPasswordChange } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { previewDataRemoval, reactivateMasterData, removeData, removalSchema } from "@/server/services/data-removal";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";
import type { RemovalEntity, RemovalPreview, RemovalState } from "@/lib/data-removal";

function errorMessage(err: unknown): string {
  if (err instanceof ForbiddenError || err instanceof ValidationError) return err.message;
  console.error("[data removal]", err);
  return "Tindakan gagal. Data belum diubah. Coba lagi.";
}

function isCurrentEntity(entity: unknown): entity is RemovalEntity {
  return entity === "user" || entity === "division" || entity === "issue_category" || entity === "division_template";
}

export async function previewRemovalAction(entity: RemovalEntity, id: string): Promise<{ preview?: RemovalPreview; error?: string }> {
  const { user } = await requireUserWithoutPasswordChange();
  if (!isCurrentEntity(entity)) return { error: "Jenis data tidak tersedia." };
  try { return { preview: previewDataRemoval(getDb(), user, entity, id) }; }
  catch (err) { return { error: errorMessage(err) }; }
}

export async function removeDataAction(_prev: RemovalState, formData: FormData): Promise<RemovalState> {
  const { user } = await requireUserWithoutPasswordChange();
  const parsed = removalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Data tidak valid" };
  if (!isCurrentEntity(parsed.data.entity)) return { error: "Jenis data tidak tersedia." };
  let result: RemovalPreview;
  try { result = removeData(getDb(), user, parsed.data); }
  catch (err) { return { error: errorMessage(err) }; }
  revalidatePath("/", "layout");
  if (result.entity === "division_template" && result.mode === "delete") redirect("/master/templates?deleted=1");
  return { ok: true, message: result.mode === "delete" ? `“${result.name}” berhasil dihapus permanen.` : `“${result.name}” diarsipkan. Riwayat tetap tersimpan.` };
}

export async function reactivateDataAction(_prev: RemovalState, formData: FormData): Promise<RemovalState> {
  const { user } = await requireUserWithoutPasswordChange();
  if (formData.get("entity") !== "issue_category") return { error: "Jenis data tidak tersedia." };
  try { reactivateMasterData(getDb(), user, "issue_category", String(formData.get("id") ?? "")); }
  catch (err) { return { error: errorMessage(err) }; }
  revalidatePath("/", "layout");
  return { ok: true, message: "Data diaktifkan kembali." };
}
