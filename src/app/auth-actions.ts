"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/server/db";
import { changeOwnPassword, login, logout } from "@/server/auth";
import { SESSION_COOKIE, cookieOptions, getSession } from "@/server/auth/session";

const loginSchema = z.object({
  email: z.string().trim().min(1, "Email wajib diisi").email("Format email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

export interface FormState {
  error?: string;
}

function clientIp(h: Awaited<ReturnType<typeof headers>>): string {
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  const h = await headers();
  const db = getDb();

  const result = await login(db, {
    email: parsed.data.email,
    password: parsed.data.password,
    ip: clientIp(h),
    userAgent: h.get("user-agent"),
  });

  if (!result.ok) {
    if (result.reason === "rate_limited") {
      const mins = Math.ceil((result.retryAfterMs ?? 0) / 60000);
      return { error: `Terlalu banyak percobaan. Coba lagi dalam ${mins} menit.` };
    }
    // Deliberately generic — must not reveal whether the email exists (§4.1).
    return { error: "Email atau password salah." };
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, result.token, cookieOptions(result.expiresAt));

  redirect(result.mustChangePassword ? "/me/password" : "/");
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const db = getDb();

  if (token) {
    const session = await getSession(db);
    await logout(db, token, session?.user.id, clientIp(await headers()));
  }

  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Password saat ini wajib diisi"),
    newPassword: z.string().min(8, "Password baru minimal 8 karakter"),
    confirmPassword: z.string().min(1, "Konfirmasi password wajib diisi"),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Konfirmasi password tidak cocok",
    path: ["confirmPassword"],
  });

export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession(getDb());
  if (!session) redirect("/login");

  const parsed = passwordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  }

  const res = await changeOwnPassword(
    getDb(),
    session.user.id,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );

  if (!res.ok) {
    const messages: Record<typeof res.reason, string> = {
      wrong_password: "Password saat ini salah.",
      weak_password: "Password baru minimal 8 karakter.",
      same_password: "Password baru tidak boleh sama dengan yang lama.",
    };
    return { error: messages[res.reason] };
  }

  // Changing the password revokes every session, so sign in again (§4.1).
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/login?changed=1");
}
