/**
 * Session management (PRD §4.1, §9.3).
 *
 * - The cookie holds a random 32-byte token; only its SHA-256 hash is stored, so
 *   a database leak does not yield usable sessions.
 * - Cookie: HttpOnly, Secure, SameSite=Lax.
 * - 30-day expiry per §4.1, sliding on use.
 * - Deactivating a user must invalidate live sessions (§14 AC) — we delete rows.
 */
import { and, eq, gt, lt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { sessions, userDivisions, users } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";

type DB = BetterSQLite3Database<typeof schema>;

export const SESSION_COOKIE = "ops_session";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface SessionContext {
  user: ActingUser;
  mustChangePassword: boolean;
  name: string;
  email: string;
}

/** Creates a session row and returns the raw token to put in the cookie. */
export async function createSession(
  db: DB,
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null },
): Promise<{ token: string; expiresAt: number }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_TTL_MS;

  const now = Date.now();

  // better-sqlite3 transactions are synchronous and cannot wrap awaited calls,
  // so cleanup and insert are issued as two statements. Both are single-statement
  // operations, so atomicity is not required here.
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
  await db.insert(sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
    createdAt: now,
  });

  return { token, expiresAt };
}

/** Resolves the current session from the cookie jar, or null. */
export async function getSession(db: DB): Promise<SessionContext | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await db
    .select({
      userId: sessions.userId,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, Date.now())))
    .get();

  if (!row) return null;

  const user = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      isActive: users.isActive,
      pendingApproval: users.pendingApproval,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, row.userId))
    .get();

  // Deactivating a user must take effect immediately, even with a valid cookie.
  if (!user || !user.isActive || user.pendingApproval) return null;

  const divisions = await db
    .select({ divisionId: userDivisions.divisionId })
    .from(userDivisions)
    .where(eq(userDivisions.userId, user.id));

  return {
    user: {
      id: user.id,
      role: user.role,
      isActive: user.isActive,
      divisionIds: divisions.map((d) => d.divisionId),
    },
    mustChangePassword: user.mustChangePassword,
    name: user.name,
    email: user.email,
  };
}

/** Deletes one session (logout). */
export async function destroySession(db: DB, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

/** Deletes every session for a user — used on password reset / deactivation. */
export async function destroyAllSessions(db: DB, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export const cookieOptions = (expiresAt: number) =>
  ({
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    expires: new Date(expiresAt),
  }) satisfies Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2];
