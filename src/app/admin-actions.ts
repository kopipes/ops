"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import {
  createDivision,
  createUser,
  resetUserPassword,
  setDivisionActive,
  setUserActive,
  updateDivision,
  updateUser,
} from "@/server/services/admin";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";

export interface AdminActionState {
  ok?: boolean;
  error?: string;
  createdId?: string;
}

async function acting() {
  const session = await requireUser();
  return session.user;
}

function toError(err: unknown): AdminActionState {
  if (err instanceof ForbiddenError || err instanceof ValidationError) return { error: err.message };
  console.error("[admin action]", err);
  return { error: "Terjadi kesalahan. Coba lagi." };
}

const revalidateAdmin = () => {
  revalidatePath("/admin/users");
  revalidatePath("/admin/divisions");
};

export async function saveUserAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await acting();
  const id = String(formData.get("id") ?? "").trim();

  const input = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    role: String(formData.get("role") ?? "user") as "admin" | "corporate" | "manager" | "user",
    primaryDivisionId: String(formData.get("primaryDivisionId") ?? ""),
    additionalDivisionIds: formData.getAll("additionalDivisionIds").map(String).filter(Boolean),
    password: String(formData.get("password") ?? ""),
  };

  if (!input.name.trim()) return { error: "Nama wajib diisi" };
  if (!input.email.trim()) return { error: "Email wajib diisi" };
  if (!input.primaryDivisionId) return { error: "Divisi utama wajib dipilih" };

  try {
    const db = getDb();
    if (id) {
      await updateUser(db, actor, id, input);
      revalidateAdmin();
      return { ok: true, createdId: id };
    }
    const createdId = await createUser(db, actor, input);
    revalidateAdmin();
    return { ok: true, createdId };
  } catch (err) {
    return toError(err);
  }
}

export async function resetPasswordAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await acting();
  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!id) return { error: "User tidak valid" };

  try {
    await resetUserPassword(getDb(), actor, id, password);
    return { ok: true };
  } catch (err) {
    return toError(err);
  }
}

export async function toggleUserActiveAction(formData: FormData): Promise<void> {
  const actor = await acting();
  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("isActive") === "1";
  if (!id) return;

  try {
    await setUserActive(getDb(), actor, id, isActive);
    revalidateAdmin();
  } catch (err) {
    console.error("[toggle user]", toError(err));
  }
}

export async function saveDivisionAction(
  _prev: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const actor = await acting();
  const id = String(formData.get("id") ?? "").trim();
  const input = {
    code: String(formData.get("code") ?? ""),
    name: String(formData.get("name") ?? ""),
    isActive: formData.get("isActive") === "on",
  };

  if (!input.code.trim()) return { error: "Kode divisi wajib diisi" };
  if (!input.name.trim()) return { error: "Nama divisi wajib diisi" };

  try {
    const db = getDb();
    if (id) {
      await updateDivision(db, actor, id, input);
      revalidateAdmin();
      return { ok: true, createdId: id };
    }
    const createdId = await createDivision(db, actor, input);
    revalidateAdmin();
    return { ok: true, createdId };
  } catch (err) {
    return toError(err);
  }
}

export async function toggleDivisionActiveAction(formData: FormData): Promise<void> {
  const actor = await acting();
  const id = String(formData.get("id") ?? "");
  const isActive = formData.get("isActive") === "1";
  if (!id) return;

  try {
    await setDivisionActive(getDb(), actor, id, isActive);
    revalidateAdmin();
  } catch (err) {
    console.error("[toggle division]", toError(err));
  }
}
