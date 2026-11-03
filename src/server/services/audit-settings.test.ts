import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import { auditFacets, listAuditLogs } from "./audit";
import { DEFAULT_SETTINGS, getGlobalSettings, saveGlobalSettings } from "./app-settings";

const MIGRATIONS = resolve(process.cwd(), "src/server/db/migrations");
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = 1_700_000_000_000;

const admin: ActingUser = { id: "u-admin", role: "admin", divisionIds: ["d-evt"], isActive: true };
const mgr: ActingUser = { id: "u-mgr", role: "manager", divisionIds: ["d-evt"], isActive: true };

beforeEach(async () => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });

  await db.insert(schema.divisions).values({
    id: "d-evt",
    code: "EVT",
    name: "Event",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values([
    { id: "u-admin", name: "Admin", email: "a@x", passwordHash: "h", role: "admin", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-mgr", name: "Mgr", email: "m@x", passwordHash: "h", role: "manager", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
  ]);

  await db.insert(schema.auditLogs).values([
    { id: "a1", userId: "u-admin", action: "auth.login", entityType: "user", entityId: "u-admin", ip: "1.1.1.1", createdAt: now },
    { id: "a2", userId: "u-mgr", action: "report.submitted", entityType: "report", entityId: "r1", createdAt: now + 1000 },
    { id: "a3", userId: "u-admin", action: "report.submitted", entityType: "report", entityId: "r2", createdAt: now + 2000 },
  ]);
});

afterEach(() => sqlite.close());

describe("audit log (§9.5 no.7)", () => {
  it("only admin may read", async () => {
    await expect(listAuditLogs(db, mgr)).rejects.toThrow();
    await expect(listAuditLogs(db, admin)).resolves.toHaveLength(3);
  });

  it("returns newest first with the actor name", async () => {
    const rows = await listAuditLogs(db, admin);
    expect(rows[0].id).toBe("a3");
    expect(rows[0].userName).toBe("Admin");
  });

  it("filters by action", async () => {
    const rows = await listAuditLogs(db, admin, { action: "report.submitted" });
    expect(rows).toHaveLength(2);
  });

  it("filters by entity type", async () => {
    const rows = await listAuditLogs(db, admin, { entityType: "user" });
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("auth.login");
  });

  it("filters by user", async () => {
    const rows = await listAuditLogs(db, admin, { userId: "u-mgr" });
    expect(rows).toHaveLength(1);
  });

  it("filters by date range", async () => {
    const rows = await listAuditLogs(db, admin, { from: now + 500, to: now + 1500 });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("a2");
  });

  it("caps the page size", async () => {
    const rows = await listAuditLogs(db, admin, { limit: 2 });
    expect(rows).toHaveLength(2);
  });

  it("provides facets for the filters", async () => {
    const facets = await auditFacets(db, admin);
    expect(facets.actions.map((a) => a.value)).toContain("auth.login");
    expect(facets.entityTypes.map((e) => e.value).sort()).toEqual(["report", "user"]);
    expect(facets.actors).toHaveLength(2);
  });
});

describe("global settings (§12 /admin/settings)", () => {
  it("returns defaults when nothing is stored", async () => {
    expect(await getGlobalSettings(db)).toEqual(DEFAULT_SETTINGS);
  });

  it("only admin may save", async () => {
    await expect(saveGlobalSettings(db, mgr, DEFAULT_SETTINGS)).rejects.toThrow();
  });

  it("persists and reloads values", async () => {
    await saveGlobalSettings(db, admin, {
      ...DEFAULT_SETTINGS,
      openingWindowEnabled: true,
      defaultOpeningWindowStart: "05:30",
      defaultOpeningWindowEnd: "10:00",
      defaultTimezone: "Asia/Makassar",
    });

    const loaded = await getGlobalSettings(db);
    expect(loaded.defaultOpeningWindowStart).toBe("05:30");
    expect(loaded.defaultOpeningWindowEnd).toBe("10:00");
    expect(loaded.defaultTimezone).toBe("Asia/Makassar");
  });

  it("rejects an invalid time format", async () => {
    await expect(
      saveGlobalSettings(db, admin, { ...DEFAULT_SETTINGS, openingWindowEnabled: true, defaultOpeningWindowStart: "25:00" }),
    ).rejects.toThrow(/Format jam/);
  });

  it("rejects start >= end", async () => {
    await expect(
      saveGlobalSettings(db, admin, {
        ...DEFAULT_SETTINGS,
        openingWindowEnabled: true,
        defaultOpeningWindowStart: "12:00",
        defaultOpeningWindowEnd: "11:00",
      }),
    ).rejects.toThrow(/sebelum jam selesai/);
  });

  it("rejects an unsupported timezone", async () => {
    await expect(
      saveGlobalSettings(db, admin, { ...DEFAULT_SETTINGS, defaultTimezone: "Europe/Paris" }),
    ).rejects.toThrow(/Timezone/);
  });

  it("writes an audit entry on save", async () => {
    await saveGlobalSettings(db, admin, DEFAULT_SETTINGS);
    const logs = await db.select().from(schema.auditLogs);
    expect(logs.some((l) => l.action === "settings.updated")).toBe(true);
  });

  it("falls back to defaults for a corrupt stored value", async () => {
    await db.insert(schema.appSettings).values({
      key: "defaultTimezone",
      valueJson: "not-json",
      updatedAt: now,
    });
    const loaded = await getGlobalSettings(db);
    expect(loaded.defaultTimezone).toBe(DEFAULT_SETTINGS.defaultTimezone);
  });

  it("saves independent window switches and accepts empty disabled time fields", async () => {
    await saveGlobalSettings(db, admin, { ...DEFAULT_SETTINGS, openingWindowEnabled: false, closingWindowEnabled: true, defaultOpeningWindowStart: "", defaultOpeningWindowEnd: "" });
    const loaded = await getGlobalSettings(db);
    expect(loaded.openingWindowEnabled).toBe(false);
    expect(loaded.closingWindowEnabled).toBe(true);
    expect(loaded.defaultOpeningWindowStart).toBe(DEFAULT_SETTINGS.defaultOpeningWindowStart);
    expect(loaded.defaultOpeningWindowEnd).toBe(DEFAULT_SETTINGS.defaultOpeningWindowEnd);
  });

  it("ignores incorrectly typed stored switches", async () => {
    await db.insert(schema.appSettings).values({ key: "openingWindowEnabled", valueJson: '"false"', updatedAt: now });
    expect((await getGlobalSettings(db)).openingWindowEnabled).toBe(false);
  });

  it("rolls back all settings if the audit write fails", async () => {
    await saveGlobalSettings(db, admin, DEFAULT_SETTINGS);
    sqlite.exec("CREATE TRIGGER fail_settings_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit failed'); END");
    await expect(saveGlobalSettings(db, admin, { ...DEFAULT_SETTINGS, openingWindowEnabled: true })).rejects.toThrow();
    expect(await getGlobalSettings(db)).toEqual(DEFAULT_SETTINGS);
  });
});
