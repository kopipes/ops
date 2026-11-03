/**
 * Auth service — the only place login/logout/password logic lives.
 */
import { eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { auditLogs, users } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  recordFailedLogin,
} from "./rate-limit";
import { createSession, destroyAllSessions, destroySession } from "./session";

type DB = BetterSQLite3Database<typeof schema>;

export type LoginResult =
  | { ok: true; token: string; expiresAt: number; mustChangePassword: boolean }
  | { ok: false; reason: "invalid_credentials" | "rate_limited"; retryAfterMs?: number };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * §4.1: email + password login. Failure messages must not reveal whether the
 * email exists — both cases return `invalid_credentials`.
 */
export async function login(
  db: DB,
  input: { email: string; password: string; ip: string; userAgent?: string | null },
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();

  const limit = checkLoginRateLimit(email, input.ip);
  if (!limit.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterMs: limit.retryAfterMs };
  }

  if (!EMAIL_RE.test(email) || input.password.length === 0) {
    recordFailedLogin(email, input.ip);
    return { ok: false, reason: "invalid_credentials" };
  }

  const user = await db
    .select({
      id: users.id,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
      pendingApproval: users.pendingApproval,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (!user || !user.isActive || user.pendingApproval) {
    // Still pay the hashing cost so timing does not disclose account existence.
    await verifyPassword(input.password, "scrypt$65536$8$1$AAAA$AAAA");
    recordFailedLogin(email, input.ip);
    return { ok: false, reason: "invalid_credentials" };
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    recordFailedLogin(email, input.ip);
    return { ok: false, reason: "invalid_credentials" };
  }

  clearLoginAttempts(email, input.ip);

  // Transparently upgrade hashes when policy parameters change.
  if (needsRehash(user.passwordHash)) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.password), updatedAt: Date.now() })
      .where(eq(users.id, user.id));
  }

  const now = Date.now();
  await db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));

  const { token, expiresAt } = await createSession(db, user.id, {
    ip: input.ip,
    userAgent: input.userAgent,
  });

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: user.id,
    action: "auth.login",
    entityType: "user",
    entityId: user.id,
    metaJson: null,
    ip: input.ip,
    createdAt: now,
  });

  return { ok: true, token, expiresAt, mustChangePassword: user.mustChangePassword };
}

export async function logout(db: DB, token: string, userId?: string, ip?: string) {
  await destroySession(db, token);
  if (userId) {
    await db.insert(auditLogs).values({
      id: randomUUID(),
      userId,
      action: "auth.logout",
      entityType: "user",
      entityId: userId,
      metaJson: null,
      ip: ip ?? null,
      createdAt: Date.now(),
    });
  }
}

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Changes the caller's own password, then invalidates all other sessions.
 * Also clears `must_change_password` (§4.1).
 */
export async function changeOwnPassword(
  db: DB,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; reason: "wrong_password" | "weak_password" | "same_password" }> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "weak_password" };
  if (newPassword === currentPassword) return { ok: false, reason: "same_password" };

  const row = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (!row) return { ok: false, reason: "wrong_password" };
  if (!(await verifyPassword(currentPassword, row.passwordHash))) {
    return { ok: false, reason: "wrong_password" };
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      updatedAt: Date.now(),
    })
    .where(eq(users.id, userId));

  // Force re-login everywhere else.
  await destroyAllSessions(db, userId);

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId,
    action: "auth.change_password",
    entityType: "user",
    entityId: userId,
    metaJson: null,
    ip: null,
    createdAt: Date.now(),
  });

  return { ok: true };
}

/**
 * Admin-initiated reset (§4.1): sets a temporary password, flags the account so
 * the user must change it on next login, and kills existing sessions.
 */
export async function adminResetPassword(
  db: DB,
  opts: { targetUserId: string; newPassword: string; actorId: string; ip?: string },
): Promise<void> {
  if (opts.newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(opts.newPassword),
      mustChangePassword: true,
      updatedAt: Date.now(),
    })
    .where(eq(users.id, opts.targetUserId));

  // §14 AC: a deactivated/reset account's old sessions must stop working.
  await destroyAllSessions(db, opts.targetUserId);

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: opts.actorId,
    action: "auth.admin_reset_password",
    entityType: "user",
    entityId: opts.targetUserId,
    metaJson: JSON.stringify({ resetBy: opts.actorId }),
    ip: opts.ip ?? null,
    createdAt: Date.now(),
  });
}

/** Deactivation must invalidate live sessions immediately (§14 AC). */
export async function deactivateUser(db: DB, targetUserId: string, actorId: string) {
  await db
    .update(users)
    .set({ isActive: false, updatedAt: Date.now() })
    .where(eq(users.id, targetUserId));
  await destroyAllSessions(db, targetUserId);
  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: actorId,
    action: "user.deactivated",
    entityType: "user",
    entityId: targetUserId,
    metaJson: null,
    ip: null,
    createdAt: Date.now(),
  });
}
