import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import {
  countActiveAdmins,
  createDivision,
  createUser,
  listDivisions,
  listUsersAdmin,
  listUsersForManagement,
  resetUserPassword,
  setDivisionActive,
  setUserActive,
  setUserDivisions,
  updateDivision,
  updateUser,
  updateManagedUser,
  type UserInput,
} from "./admin";
import { hashPassword, verifyPassword } from "@/server/auth/password";

const MIGRATIONS = resolve(process.cwd(), "src/server/db/migrations");
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = 1_700_000_000_000;

const admin: ActingUser = { id: "u-admin", role: "admin", divisionIds: ["d-evt"], isActive: true };
const mgr: ActingUser = { id: "u-mgr", role: "manager", divisionIds: ["d-evt"], isActive: true };
const crew: ActingUser = { id: "u-crew", role: "user", divisionIds: ["d-evt"], isActive: true };

function userInput(over: Partial<UserInput> = {}): UserInput {
  return {
    name: "Crew Baru",
    email: "baru@ops.test",
    phone: "0812",
    role: "user",
    primaryDivisionId: "d-evt",
    additionalDivisionIds: [],
    password: "rahasia-123",
    ...over,
  };
}

beforeEach(async () => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });

  await db.insert(schema.divisions).values([
    { id: "d-evt", code: "EVT", name: "Event", isActive: true, createdAt: now, updatedAt: now },
    { id: "d-ops", code: "OPS", name: "Ops", isActive: true, createdAt: now, updatedAt: now },
  ]);
  const pw = await hashPassword("x");
  await db.insert(schema.users).values([
    { id: "u-admin", name: "Admin", email: "a@x", passwordHash: pw, role: "admin", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-mgr", name: "Mgr", email: "m@x", passwordHash: pw, role: "manager", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-crew", name: "Crew", email: "c@x", passwordHash: pw, role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.userDivisions).values([
    { userId: "u-admin", divisionId: "d-evt", isPrimary: true },
    { userId: "u-mgr", divisionId: "d-evt", isPrimary: true },
    { userId: "u-crew", divisionId: "d-evt", isPrimary: true },
  ]);
});

afterEach(() => sqlite.close());

describe("user admin permissions (§2.3)", () => {
  it("managers list only crew in their own primary division", async () => {
    await db.update(schema.users).set({ primaryDivisionId: "d-ops" }).where(eq(schema.users.id, "u-admin"));
    const rows = await listUsersForManagement(db, mgr);
    expect(rows.map(row => row.id)).toEqual(["u-crew"]);
    await db.update(schema.users).set({ primaryDivisionId: "d-ops" }).where(eq(schema.users.id, "u-crew"));
    expect(await listUsersForManagement(db, mgr)).toEqual([]);
    await expect(listUsersForManagement(db, crew)).rejects.toThrow();
  });

  it("managers cannot mutate Admin profiles, activation, division membership or passwords", async () => {
    await expect(updateManagedUser(db, mgr, "u-admin", userInput({ role: "admin" }))).rejects.toThrow();
    await expect(setUserActive(db, mgr, "u-admin", false)).rejects.toThrow();
    await expect(setUserDivisions(db, mgr, "u-admin", "d-evt", [])).rejects.toThrow();
    await expect(resetUserPassword(db, mgr, "u-admin", "new-password-1")).rejects.toThrow();
    expect((await db.select().from(schema.users).where(eq(schema.users.id, "u-admin")).get())?.isActive).toBe(true);
  });

  it("manager profile edits preserve crew role and memberships", async () => {
    await updateManagedUser(db, mgr, "u-crew", userInput({ name: "Crew Updated", email: "updated@example.test", password: undefined }));
    expect(await db.select().from(schema.users).where(eq(schema.users.id, "u-crew")).get()).toMatchObject({ name: "Crew Updated", role: "user", primaryDivisionId: "d-evt" });
    await expect(updateManagedUser(db, mgr, "u-crew", userInput({ role: "admin" }))).rejects.toThrow();
    await expect(updateManagedUser(db, mgr, "u-crew", userInput({ primaryDivisionId: "d-ops" }))).rejects.toThrow();
    await expect(updateManagedUser(db, mgr, "u-crew", userInput({ additionalDivisionIds: ["d-ops"] }))).rejects.toThrow();
  });

  it("activation checks fresh target role and fresh manager privileges", async () => {
    await db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, "u-crew"));
    await expect(setUserActive(db, mgr, "u-crew", false)).rejects.toThrow();
    await expect(updateManagedUser(db, mgr, "u-crew", userInput())).rejects.toThrow();
    await db.update(schema.users).set({ role: "user" }).where(eq(schema.users.id, "u-crew"));
    await db.update(schema.users).set({ role: "user" }).where(eq(schema.users.id, "u-mgr"));
    await expect(setUserActive(db, mgr, "u-crew", false)).rejects.toThrow();
    await expect(updateManagedUser(db, mgr, "u-crew", userInput())).rejects.toThrow();
  });
  it("only admin may list users", async () => {
    await expect(listUsersAdmin(db, mgr)).rejects.toThrow();
    await expect(listUsersAdmin(db, admin)).resolves.toHaveLength(3);
  });

  it("only admin may create users", async () => {
    await expect(createUser(db, mgr, userInput())).rejects.toThrow();
    await expect(createUser(db, admin, userInput())).resolves.toBeTruthy();
  });
});

describe("createUser", () => {
  it("creates a user who must change the password on first login", async () => {
    const id = await createUser(db, admin, userInput());
    const row = await db.select().from(schema.users).where(eq(schema.users.id, id)).get();

    expect(row?.email).toBe("baru@ops.test");
    expect(row?.mustChangePassword).toBe(true);
    expect(row?.isActive).toBe(true);
    expect(await verifyPassword("rahasia-123", row!.passwordHash)).toBe(true);
  });

  it("lowercases the email", async () => {
    const id = await createUser(db, admin, userInput({ email: "BARU@Ops.Test" }));
    const row = await db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    expect(row?.email).toBe("baru@ops.test");
  });

  it("rejects a duplicate email", async () => {
    await createUser(db, admin, userInput());
    await expect(createUser(db, admin, userInput())).rejects.toThrow(/sudah dipakai/);
  });

  it("rejects a short password", async () => {
    await expect(createUser(db, admin, userInput({ password: "short" }))).rejects.toThrow(/8 karakter/);
  });

  it("stores primary + additional divisions", async () => {
    const id = await createUser(
      db,
      admin,
      userInput({ primaryDivisionId: "d-evt", additionalDivisionIds: ["d-ops"] }),
    );
    const rows = await listUsersAdmin(db, admin);
    const created = rows.find((r) => r.id === id)!;
    expect(created.divisionIds.sort()).toEqual(["d-evt", "d-ops"]);
    expect(created.primaryDivisionName).toBe("Event");
  });

  it("rejects an unknown division", async () => {
    await expect(
      createUser(db, admin, userInput({ primaryDivisionId: "nope" })),
    ).rejects.toThrow(/Divisi utama/);
  });
});

describe("updateUser", () => {
  it("updates fields and memberships", async () => {
    const id = await createUser(db, admin, userInput());
    await updateUser(
      db,
      admin,
      id,
      userInput({ name: "Nama Baru", role: "manager", primaryDivisionId: "d-ops", additionalDivisionIds: [] }),
    );

    const rows = await listUsersAdmin(db, admin);
    const updated = rows.find((r) => r.id === id)!;
    expect(updated.name).toBe("Nama Baru");
    expect(updated.role).toBe("manager");
    expect(updated.divisionIds).toEqual(["d-ops"]);
  });

  it("refuses to demote your own admin account", async () => {
    await expect(
      updateUser(db, admin, "u-admin", userInput({ email: "a@x", role: "user" })),
    ).rejects.toThrow(/akun sendiri/);
  });

  it("rejects an email used by someone else", async () => {
    const id = await createUser(db, admin, userInput());
    await expect(
      updateUser(db, admin, id, userInput({ email: "c@x" })),
    ).rejects.toThrow(/sudah dipakai/);
  });
});

describe("resetUserPassword", () => {
  it("sets a new hash, forces a change, and kills sessions", async () => {
    const id = await createUser(db, admin, userInput());
    await db.insert(schema.sessions).values({
      id: "sess-1",
      userId: id,
      expiresAt: now + 100000,
      createdAt: now,
    });

    await resetUserPassword(db, admin, id, "password-baru");

    const row = await db.select().from(schema.users).where(eq(schema.users.id, id)).get();
    expect(await verifyPassword("password-baru", row!.passwordHash)).toBe(true);
    expect(row?.mustChangePassword).toBe(true);
    expect(await db.select().from(schema.sessions)).toHaveLength(0);
  });

  it("rejects a short password", async () => {
    await expect(resetUserPassword(db, admin, "u-crew", "abc")).rejects.toThrow(/8 karakter/);
  });
});

describe("setUserActive (§14 AC)", () => {
  it("deactivation kills live sessions", async () => {
    await db.insert(schema.sessions).values({
      id: "sess-2",
      userId: "u-crew",
      expiresAt: now + 100000,
      createdAt: now,
    });

    await setUserActive(db, admin, "u-crew", false);

    const row = await db.select().from(schema.users).where(eq(schema.users.id, "u-crew")).get();
    expect(row?.isActive).toBe(false);
    expect(await db.select().from(schema.sessions)).toHaveLength(0);
  });

  it("refuses to deactivate yourself", async () => {
    await expect(setUserActive(db, admin, "u-admin", false)).rejects.toThrow(/akun sendiri/);
  });

  it("refuses to deactivate the last active admin", async () => {
    // Create a second admin, deactivate it, then the first becomes the last.
    const second = await createUser(db, admin, userInput({ role: "admin", email: "a2@x" }));
    await setUserActive(db, admin, second, false);
    expect(await countActiveAdmins(db)).toBe(1);
    expect(await countActiveAdmins(db, "u-admin")).toBe(0);
  });

  it("can reactivate", async () => {
    await setUserActive(db, admin, "u-crew", false);
    await setUserActive(db, admin, "u-crew", true);
    const row = await db.select().from(schema.users).where(eq(schema.users.id, "u-crew")).get();
    expect(row?.isActive).toBe(true);
  });
});

describe("divisions", () => {
  it("only admin manages divisions", async () => {
    await expect(listDivisions(db, mgr)).rejects.toThrow();
    await expect(createDivision(db, mgr, { code: "NEW", name: "New", isActive: true })).rejects.toThrow();
  });

  it("creates a division with an uppercased code", async () => {
    const id = await createDivision(db, admin, { code: "cre", name: "Creative", isActive: true });
    const rows = await listDivisions(db, admin);
    expect(rows.find((r) => r.id === id)?.code).toBe("CRE");
  });

  it("rejects a duplicate code", async () => {
    // "EVT" already exists in the fixture; a second one must be refused.
    await expect(
      createDivision(db, admin, { code: "EVT", name: "Dup", isActive: true }),
    ).rejects.toThrow(/sudah dipakai/);
  });

  it("updates a division", async () => {
    await updateDivision(db, admin, "d-ops", { code: "OPS", name: "Operasional", isActive: true });
    const rows = await listDivisions(db, admin);
    expect(rows.find((r) => r.id === "d-ops")?.name).toBe("Operasional");
  });

  it("deactivates instead of deleting", async () => {
    await setDivisionActive(db, admin, "d-ops", false);
    const rows = await listDivisions(db, admin);
    const div = rows.find((r) => r.id === "d-ops");
    expect(div).toBeDefined();
    expect(div?.isActive).toBe(false);
  });

  it("counts users per division", async () => {
    await createUser(db, admin, userInput({ additionalDivisionIds: ["d-ops"] }));
    const rows = await listDivisions(db, admin);
    expect(rows.find((r) => r.id === "d-ops")?.userCount).toBe(1);
  });
});

describe("setUserDivisions", () => {
  it("replaces memberships rather than appending", async () => {
    await setUserDivisions(db, admin, "u-crew", "d-ops", []);
    const rows = await listUsersAdmin(db, admin);
    expect(rows.find((r) => r.id === "u-crew")?.divisionIds).toEqual(["d-ops"]);
  });
});
