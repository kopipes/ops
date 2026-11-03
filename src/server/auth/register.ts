import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auditLogs, divisions, userDivisions, users } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { hashPassword } from "./password";
import { takeRegistrationAttempt } from "./rate-limit";

const inputSchema = z.object({
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(120),
  email: z.string().trim().max(254).email("Format email tidak valid").toLowerCase(),
  phone: z.string().trim().max(30).optional(),
  primaryDivisionId: z.string().trim().min(1, "Pilih divisi").max(100),
  password: z.string().min(8, "Password minimal 8 karakter").max(128, "Password maksimal 128 karakter"),
});

export type RegistrationResult = { ok: true; userId: string | null } | { ok: false; error: string };

/** Public callers can only create inactive crew; role/activation input is ignored. */
export async function registerAccount(db: BetterSQLite3Database<typeof schema>, input: unknown, ip: string): Promise<RegistrationResult> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Input tidak valid" };
  const limit = takeRegistrationAttempt(ip);
  if (!limit.allowed) return { ok: false, error: "Terlalu banyak pendaftaran. Coba lagi dalam 15 menit." };
  const values = parsed.data;
  const division = () => db.select({ id: divisions.id }).from(divisions).where(and(eq(divisions.id, values.primaryDivisionId), eq(divisions.isActive, true))).get();
  if (!division()) return { ok: false, error: "Divisi tidak tersedia. Pilih divisi aktif." };
  const passwordHash = await hashPassword(values.password);

  return db.transaction((tx): RegistrationResult => {
    // Recheck after hashing; parallel requests must not create duplicate accounts.
    if (tx.select({ id: users.id }).from(users).where(eq(users.email, values.email)).get()) {
      // Same public outcome and hashing cost; never replace an existing account.
      return { ok: true, userId: null };
    }
    if (!tx.select({ id: divisions.id }).from(divisions).where(and(eq(divisions.id, values.primaryDivisionId), eq(divisions.isActive, true))).get()) {
      return { ok: false, error: "Divisi tidak tersedia. Pilih divisi aktif." };
    }
    const userId = randomUUID();
    const now = Date.now();
    tx.insert(users).values({ id: userId, name: values.name, email: values.email, phone: values.phone || null, passwordHash, role: "user", primaryDivisionId: values.primaryDivisionId, isActive: false, pendingApproval: true, mustChangePassword: false, createdAt: now, updatedAt: now }).run();
    tx.insert(userDivisions).values({ userId, divisionId: values.primaryDivisionId, isPrimary: true }).run();
    tx.insert(auditLogs).values({ id: randomUUID(), userId, action: "auth.registered", entityType: "user", entityId: userId, metaJson: JSON.stringify({ pendingApproval: true, divisionId: values.primaryDivisionId }), ip, createdAt: now }).run();
    return { ok: true, userId };
  });
}
