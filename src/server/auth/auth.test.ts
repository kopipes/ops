import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import { adminResetPassword, changeOwnPassword, login } from "./index";
import { hashPassword, needsRehash, verifyPassword } from "./password";
import { _resetRateLimits, MAX_ATTEMPTS } from "./rate-limit";

const MIGRATIONS = resolve(process.cwd(), "src/server/db/migrations");

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

const now = 1_700_000_000_000;

beforeEach(async () => {
  _resetRateLimits();
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });

  sqlite
    .prepare("insert into divisions (id,code,name,is_active,created_at,updated_at) values (?,?,?,1,?,?)")
    .run("d1", "EVT", "Event", now, now);

  await db.insert(schema.users).values({
    id: "u1",
    name: "Crew One",
    email: "crew@example.com",
    passwordHash: await hashPassword("correct horse battery"),
    role: "user",
    primaryDivisionId: "d1",
    mustChangePassword: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.userDivisions).values({ userId: "u1", divisionId: "d1", isPrimary: true });
});

afterEach(() => sqlite.close());

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("s3cret-password");
    expect(await verifyPassword("s3cret-password", hash)).toBe(true);
    expect(await verifyPassword("s3cret-passwore", hash)).toBe(false);
  });

  it("produces a distinct salt each time", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same-password", a)).toBe(true);
    expect(await verifyPassword("same-password", b)).toBe(true);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });

  it("flags weaker parameters for rehash", async () => {
    expect(needsRehash("scrypt$1024$8$1$AAAA$AAAA")).toBe(true);
    expect(needsRehash(await hashPassword("x"))).toBe(false);
  });
});

describe("login (§4.1)", () => {
  it("succeeds with correct credentials", async () => {
    const res = await login(db, {
      email: "crew@example.com",
      password: "correct horse battery",
      ip: "1.1.1.1",
    });
    expect(res.ok).toBe(true);
  });

  it("is case-insensitive on email", async () => {
    const res = await login(db, {
      email: "CREW@Example.COM",
      password: "correct horse battery",
      ip: "1.1.1.1",
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const res = await login(db, { email: "crew@example.com", password: "nope", ip: "1.1.1.1" });
    expect(res).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("gives the same error for an unknown email (no user enumeration)", async () => {
    const res = await login(db, { email: "ghost@example.com", password: "whatever", ip: "1.1.1.1" });
    expect(res).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("refuses an inactive user", async () => {
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u1"));
    const res = await login(db, {
      email: "crew@example.com",
      password: "correct horse battery",
      ip: "1.1.1.1",
    });
    expect(res.ok).toBe(false);
  });

  it("rate limits after 5 failures (§9.3)", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = await login(db, { email: "crew@example.com", password: "bad", ip: "9.9.9.9" });
      expect(r.ok).toBe(false);
    }
    const blocked = await login(db, {
      email: "crew@example.com",
      password: "correct horse battery",
      ip: "9.9.9.9",
    });
    expect(blocked).toMatchObject({ ok: false, reason: "rate_limited" });
  });

  it("rate limits per IP, not globally", async () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      await login(db, { email: "crew@example.com", password: "bad", ip: "8.8.8.8" });
    }
    const otherIp = await login(db, {
      email: "crew@example.com",
      password: "correct horse battery",
      ip: "7.7.7.7",
    });
    expect(otherIp.ok).toBe(true);
  });

  it("stores only a hash of the session token", async () => {
    const res = await login(db, {
      email: "crew@example.com",
      password: "correct horse battery",
      ip: "1.1.1.1",
    });
    if (!res.ok) throw new Error("expected login to succeed");
    const rows = await db.select().from(schema.sessions);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(res.token);
    expect(rows[0].id).toHaveLength(64); // sha256 hex
  });

  it("flags must_change_password for a reset account", async () => {
    await adminResetPassword(db, {
      targetUserId: "u1",
      newPassword: "temporary-password",
      actorId: "u1",
    });
    const res = await login(db, { email: "crew@example.com", password: "temporary-password", ip: "1.1.1.1" });
    expect(res).toMatchObject({ ok: true, mustChangePassword: true });
  });
});

describe("changeOwnPassword (§4.1)", () => {
  it("changes the password, clears the flag and revokes sessions", async () => {
    await login(db, { email: "crew@example.com", password: "correct horse battery", ip: "1.1.1.1" });
    expect(await db.select().from(schema.sessions)).toHaveLength(1);

    const res = await changeOwnPassword(db, "u1", "correct horse battery", "brand-new-password");
    expect(res).toEqual({ ok: true });

    expect(await db.select().from(schema.sessions)).toHaveLength(0);

    const after = await login(db, { email: "crew@example.com", password: "brand-new-password", ip: "2.2.2.2" });
    expect(after.ok).toBe(true);
  });

  it("rejects a short password", async () => {
    expect(await changeOwnPassword(db, "u1", "correct horse battery", "short")).toEqual({
      ok: false,
      reason: "weak_password",
    });
  });

  it("rejects a wrong current password", async () => {
    expect(await changeOwnPassword(db, "u1", "wrong-current", "brand-new-password")).toEqual({
      ok: false,
      reason: "wrong_password",
    });
  });

  it("rejects reusing the same password", async () => {
    expect(
      await changeOwnPassword(db, "u1", "correct horse battery", "correct horse battery"),
    ).toEqual({ ok: false, reason: "same_password" });
  });
});

describe("admin reset (§4.1)", () => {
  it("revokes existing sessions immediately", async () => {
    await login(db, { email: "crew@example.com", password: "correct horse battery", ip: "1.1.1.1" });
    expect(await db.select().from(schema.sessions)).toHaveLength(1);

    await adminResetPassword(db, { targetUserId: "u1", newPassword: "reset-password-1", actorId: "u1" });
    expect(await db.select().from(schema.sessions)).toHaveLength(0);
  });

  it("writes an audit log entry", async () => {
    await adminResetPassword(db, { targetUserId: "u1", newPassword: "reset-password-1", actorId: "u1" });
    const logs = await db.select().from(schema.auditLogs);
    expect(logs.some((l) => l.action === "auth.admin_reset_password")).toBe(true);
  });
});
