import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import { registerAccount } from "./register";
import { login } from "./index";
import { createSession, getSession } from "./session";
import { verifyPassword } from "./password";
import { _resetRateLimits } from "./rate-limit";
import { setUserActive } from "@/server/services/admin";
import type { ActingUser } from "@/server/permissions";

const cookie = vi.hoisted(() => ({ value: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => cookie.value ? { value: cookie.value } : undefined }) }));

let raw: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const admin: ActingUser = { id: "admin", role: "admin", divisionIds: ["event"], isActive: true };
const manager: ActingUser = { id: "manager", role: "manager", divisionIds: ["event"], isActive: true };
const input = (over: Record<string, unknown> = {}) => ({ name: "Crew Baru", email: "crew@example.test", primaryDivisionId: "event", password: "valid-password-1", ...over });

beforeEach(() => {
  _resetRateLimits();
  cookie.value = "";
  raw = new Database(":memory:");
  raw.pragma("foreign_keys = ON");
  db = drizzle(raw, { schema });
  migrate(db, { migrationsFolder: resolve("src/server/db/migrations") });
  db.insert(schema.divisions).values([
    { id: "event", code: "EVT", name: "Event Production" },
    { id: "finance", code: "FIN", name: "Finance" },
    { id: "inactive", code: "OLD", name: "Inactive", isActive: false },
  ]).run();
  db.insert(schema.users).values([
    { id: "admin", name: "Admin", email: "admin@example.test", passwordHash: "unused", role: "admin", primaryDivisionId: "event" },
    { id: "manager", name: "Manager", email: "manager@example.test", passwordHash: "unused", role: "manager", primaryDivisionId: "event" },
  ]).run();
  db.insert(schema.userDivisions).values([
    { userId: "admin", divisionId: "event", isPrimary: true },
    { userId: "manager", divisionId: "event", isPrimary: true },
  ]).run();
});
afterEach(() => raw.close());

describe("public registration", () => {
  it("forces inactive pending crew and one division despite privilege injection", async () => {
    const result = await registerAccount(db, input({ role: "admin", isActive: true, pendingApproval: false, additionalDivisionIds: ["finance"] }), "ip");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.userId) throw new Error("Expected a new account");
    const user = db.select().from(schema.users).where(eq(schema.users.id, result.userId)).get()!;
    expect(user).toMatchObject({ role: "user", isActive: false, pendingApproval: true, mustChangePassword: false });
    expect(await verifyPassword("valid-password-1", user.passwordHash)).toBe(true);
    expect(db.select().from(schema.userDivisions).where(eq(schema.userDivisions.userId, user.id)).all()).toMatchObject([{ divisionId: "event", isPrimary: true }]);
    expect(db.select().from(schema.sessions).all()).toHaveLength(0);
    const audit = db.select().from(schema.auditLogs).all();
    expect(audit[0].action).toBe("auth.registered");
    expect(JSON.stringify(audit)).not.toContain("valid-password-1");
  });

  it("normalizes email and handles simultaneous duplicate requests atomically", async () => {
    const results = await Promise.all([
      registerAccount(db, input({ email: " Mixed@Example.Test " }), "ip"),
      registerAccount(db, input({ email: "mixed@example.test" }), "ip"),
    ]);
    expect(results.every(result => result.ok)).toBe(true);
    expect(results.filter(result => result.ok && result.userId)).toHaveLength(1);
    expect(db.select().from(schema.users).where(eq(schema.users.email, "mixed@example.test")).all()).toHaveLength(1);
    expect(raw.pragma("foreign_key_check")).toEqual([]);
  });

  it("rejects inactive/unknown divisions and invalid account input", async () => {
    for (const over of [{ primaryDivisionId: "inactive" }, { primaryDivisionId: "missing" }, { password: "short" }, { email: "invalid" }]) {
      expect((await registerAccount(db, input(over), "ip")).ok).toBe(false);
    }
    expect(db.select().from(schema.users).all()).toHaveLength(2);
  });

  it("keeps pending accounts out of login and sessions until manager approval", async () => {
    const result = await registerAccount(db, input(), "ip");
    if (!result.ok || !result.userId) throw new Error("Expected a new account");
    expect((await login(db, { email: "crew@example.test", password: "valid-password-1", ip: "login-ip" })).ok).toBe(false);
    cookie.value = (await createSession(db, result.userId, {})).token;
    expect(await getSession(db)).toBeNull();
    await setUserActive(db, manager, result.userId, true);
    expect((await login(db, { email: "crew@example.test", password: "valid-password-1", ip: "login-ip" })).ok).toBe(true);
    expect((await getSession(db))?.user.id).toBe(result.userId);
    const activated = db.select().from(schema.auditLogs).where(eq(schema.auditLogs.action, "user.activated")).get();
    expect(activated?.userId).toBe(manager.id);
    expect(db.select().from(schema.users).where(eq(schema.users.id, result.userId)).get()?.pendingApproval).toBe(false);
  });

  it("requires Admin for a registration outside the manager division", async () => {
    const result = await registerAccount(db, input({ primaryDivisionId: "finance" }), "ip");
    if (!result.ok || !result.userId) throw new Error("Expected a new account");
    await expect(setUserActive(db, manager, result.userId, true)).rejects.toThrow();
    await setUserActive(db, admin, result.userId, true);
    expect(db.select().from(schema.users).where(eq(schema.users.id, result.userId)).get()).toMatchObject({ isActive: true, pendingApproval: false });
  });

  it("does not permit an active flag to bypass a still-pending approval", async () => {
    const result = await registerAccount(db, input(), "ip");
    if (!result.ok || !result.userId) throw new Error("Expected a new account");
    db.update(schema.users).set({ isActive: true }).where(eq(schema.users.id, result.userId)).run();
    expect((await login(db, { email: "crew@example.test", password: "valid-password-1", ip: "login-ip" })).ok).toBe(false);
    cookie.value = (await createSession(db, result.userId, {})).token;
    expect(await getSession(db)).toBeNull();
  });

  it("throttles registration per IP even across different emails", async () => {
    for (let index = 0; index < 5; index++) expect((await registerAccount(db, input({ email: `crew${index}@example.test` }), "same-ip")).ok).toBe(true);
    const blocked = await registerAccount(db, input({ email: "crew6@example.test" }), "same-ip");
    expect(blocked).toMatchObject({ ok: false, error: expect.stringContaining("Terlalu banyak") });
  });

  it("rolls back account and membership if the registration audit cannot be saved", async () => {
    raw.exec("CREATE TRIGGER fail_registration_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit failed'); END");
    await expect(registerAccount(db, input(), "ip")).rejects.toThrow();
    expect(db.select().from(schema.users).all()).toHaveLength(2);
    expect(db.select().from(schema.userDivisions).all()).toHaveLength(2);
  });
});
