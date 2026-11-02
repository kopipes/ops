/**
 * User & division administration (§12 /admin/*).
 *
 * These are the surfaces that make the app usable without touching the database:
 * without them, real crew cannot be onboarded (AC "Admin bisa membuat user").
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { divisions, sessions, userDivisions, users } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { canManageDivisions, canManageUsers, type ActingUser } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";
import { hashPassword } from "@/server/auth/password";

type DB = BetterSQLite3Database<typeof schema>;

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "admin" | "corporate" | "manager" | "user";
  primaryDivisionId: string | null;
  primaryDivisionName: string | null;
  divisionIds: string[];
  mustChangePassword: boolean;
  isActive: boolean;
  lastLoginAt: number | null;
  createdAt: number;
}

export async function listUsersAdmin(db: DB, actor: ActingUser): Promise<AdminUserRow[]> {
  if (!canManageUsers(actor)) throw new ForbiddenError();

  const rows = await db.select().from(users).orderBy(asc(users.name));
  if (rows.length === 0) return [];

  const memberships = await db
    .select({ userId: userDivisions.userId, divisionId: userDivisions.divisionId })
    .from(userDivisions)
    .where(
      inArray(
        userDivisions.userId,
        rows.map((r) => r.id),
      ),
    );

  const divisionRows = await db.select({ id: divisions.id, name: divisions.name }).from(divisions);
  const divisionName = new Map(divisionRows.map((d) => [d.id, d.name]));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    primaryDivisionId: r.primaryDivisionId,
    primaryDivisionName: r.primaryDivisionId ? (divisionName.get(r.primaryDivisionId) ?? null) : null,
    divisionIds: memberships.filter((m) => m.userId === r.id).map((m) => m.divisionId),
    mustChangePassword: r.mustChangePassword,
    isActive: r.isActive,
    lastLoginAt: r.lastLoginAt,
    createdAt: r.createdAt,
  }));
}

export interface UserInput {
  name: string;
  email: string;
  phone?: string | null;
  role: "admin" | "corporate" | "manager" | "user";
  primaryDivisionId: string;
  additionalDivisionIds: string[];
  /** Required on create; ignored on update (use setPassword). */
  password?: string;
}

export async function createUser(db: DB, actor: ActingUser, input: UserInput): Promise<string> {
  if (!canManageUsers(actor)) throw new ForbiddenError();

  if (!input.password || input.password.length < 8) {
    throw new ValidationError("Password minimal 8 karakter");
  }

  const email = input.email.trim().toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();
  if (existing) throw new ValidationError(`Email "${email}" sudah dipakai`);

  const divisionExists = await db
    .select({ id: divisions.id })
    .from(divisions)
    .where(eq(divisions.id, input.primaryDivisionId))
    .get();
  if (!divisionExists) throw new ValidationError("Divisi utama tidak ditemukan");

  const id = randomUUID();
  const now = Date.now();

  await db.insert(users).values({
    id,
    name: input.name.trim(),
    email,
    phone: input.phone?.trim() || null,
    passwordHash: await hashPassword(input.password),
    role: input.role,
    primaryDivisionId: input.primaryDivisionId,
    // A fresh account uses the admin-set password once, then must change it.
    mustChangePassword: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  await setUserDivisions(db, actor, id, input.primaryDivisionId, input.additionalDivisionIds);
  return id;
}

export async function updateUser(
  db: DB,
  actor: ActingUser,
  userId: string,
  input: UserInput,
): Promise<void> {
  if (!canManageUsers(actor)) throw new ForbiddenError();

  const current = await db.select().from(users).where(eq(users.id, userId)).get();
  if (!current) throw new ValidationError("User tidak ditemukan");

  const email = input.email.trim().toLowerCase();
  const clash = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .get();
  if (clash && clash.id !== userId) throw new ValidationError(`Email "${email}" sudah dipakai`);

  // Guard against an admin locking themselves out.
  if (current.id === actor.id && input.role !== "admin") {
    throw new ValidationError("Tidak bisa menurunkan role akun sendiri");
  }

  await db
    .update(users)
    .set({
      name: input.name.trim(),
      email,
      phone: input.phone?.trim() || null,
      role: input.role,
      primaryDivisionId: input.primaryDivisionId,
      updatedAt: Date.now(),
    })
    .where(eq(users.id, userId));

  await setUserDivisions(db, actor, userId, input.primaryDivisionId, input.additionalDivisionIds);
}

/**
 * Replaces memberships: primary + additional. The primary division is always
 * present in `user_divisions` so visibility checks have one source of truth.
 */
export async function setUserDivisions(
  db: DB,
  actor: ActingUser,
  userId: string,
  primaryDivisionId: string,
  additionalDivisionIds: string[],
): Promise<void> {
  if (!canManageUsers(actor)) throw new ForbiddenError();

  await db.delete(userDivisions).where(eq(userDivisions.userId, userId));

  const all = [...new Set([primaryDivisionId, ...additionalDivisionIds])];
  if (all.length === 0) return;

  await db.insert(userDivisions).values(
    all.map((divisionId) => ({
      userId,
      divisionId,
      isPrimary: divisionId === primaryDivisionId,
    })),
  );
}

/** Admin sets a temporary password; the user must change it on next login. */
export async function resetUserPassword(
  db: DB,
  actor: ActingUser,
  userId: string,
  newPassword: string,
): Promise<void> {
  if (!canManageUsers(actor)) throw new ForbiddenError();
  if (newPassword.length < 8) throw new ValidationError("Password minimal 8 karakter");

  const target = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).get();
  if (!target) throw new ValidationError("User tidak ditemukan");

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: true,
      updatedAt: Date.now(),
    })
    .where(eq(users.id, userId));

  // §14 AC: "session lama langsung invalid".
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function setUserActive(
  db: DB,
  actor: ActingUser,
  userId: string,
  isActive: boolean,
): Promise<void> {
  if (!canManageUsers(actor)) throw new ForbiddenError();
  if (userId === actor.id) throw new ValidationError("Tidak bisa menonaktifkan akun sendiri");

  if (!isActive) {
    // Never leave the system without an admin who can log in.
    const target = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).get();
    if (target?.role === "admin" && (await countActiveAdmins(db, userId)) === 0) {
      throw new ValidationError("Tidak bisa menonaktifkan Admin terakhir");
    }
  }

  await db
    .update(users)
    .set({ isActive, updatedAt: Date.now() })
    .where(eq(users.id, userId));

  if (!isActive) {
    // §14 AC: deactivation invalidates live sessions immediately.
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }
}

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

export interface DivisionRow {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  userCount: number;
  projectCount: number;
}

export async function listDivisions(db: DB, actor: ActingUser): Promise<DivisionRow[]> {
  if (!canManageDivisions(actor)) throw new ForbiddenError();

  const rows = await db.select().from(divisions).orderBy(asc(divisions.name));
  if (rows.length === 0) return [];

  const memberships = await db
    .select({ divisionId: userDivisions.divisionId })
    .from(userDivisions)
    .where(
      inArray(
        userDivisions.divisionId,
        rows.map((r) => r.id),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    isActive: r.isActive,
    userCount: memberships.filter((m) => m.divisionId === r.id).length,
    projectCount: 0,
  }));
}

export interface DivisionInput {
  code: string;
  name: string;
  isActive: boolean;
}

export async function createDivision(
  db: DB,
  actor: ActingUser,
  input: DivisionInput,
): Promise<string> {
  if (!canManageDivisions(actor)) throw new ForbiddenError();

  const code = input.code.trim().toUpperCase();
  const clash = await db.select({ id: divisions.id }).from(divisions).where(eq(divisions.code, code)).get();
  if (clash) throw new ValidationError(`Kode divisi "${code}" sudah dipakai`);

  const id = randomUUID();
  const now = Date.now();
  await db.insert(divisions).values({
    id,
    code,
    name: input.name.trim(),
    isActive: input.isActive,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function updateDivision(
  db: DB,
  actor: ActingUser,
  divisionId: string,
  input: DivisionInput,
): Promise<void> {
  if (!canManageDivisions(actor)) throw new ForbiddenError();

  const current = await db.select().from(divisions).where(eq(divisions.id, divisionId)).get();
  if (!current) throw new ValidationError("Divisi tidak ditemukan");

  const code = input.code.trim().toUpperCase();
  const clash = await db
    .select({ id: divisions.id })
    .from(divisions)
    .where(eq(divisions.code, code))
    .get();
  if (clash && clash.id !== divisionId) {
    throw new ValidationError(`Kode divisi "${code}" sudah dipakai`);
  }

  await db
    .update(divisions)
    .set({ code, name: input.name.trim(), isActive: input.isActive, updatedAt: Date.now() })
    .where(eq(divisions.id, divisionId));
}

/**
 * Divisions are deactivated, never deleted: users and projects reference them,
 * and historical reports resolve division names through them.
 */
export async function setDivisionActive(
  db: DB,
  actor: ActingUser,
  divisionId: string,
  isActive: boolean,
): Promise<void> {
  if (!canManageDivisions(actor)) throw new ForbiddenError();
  await db
    .update(divisions)
    .set({ isActive, updatedAt: Date.now() })
    .where(eq(divisions.id, divisionId));
}

/** Active divisions for pickers. */
export async function listActiveDivisions(db: DB) {
  return db
    .select({ id: divisions.id, name: divisions.name, code: divisions.code })
    .from(divisions)
    .where(eq(divisions.isActive, true))
    .orderBy(asc(divisions.name));
}

/** Admins who are still active — used to warn before deactivating the last one. */
export async function countActiveAdmins(db: DB, excludingUserId?: string): Promise<number> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, "admin"), eq(users.isActive, true)));
  return rows.filter((r) => r.id !== excludingUserId).length;
}
