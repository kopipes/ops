/**
 * Integration tests for the §11.7 visibility helper.
 *
 * These exist specifically to lock in the fix for the fan-out bug: the original
 * draft query LEFT JOINed `user_divisions`, which returns a project multiple
 * times when a user belongs to several divisions.
 */
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import * as schema from "./db/schema";
import type { ActingUser } from "./permissions";
import { loadProjectFacts, visibleProjectIds } from "./visibility";

const MIGRATIONS = resolve(process.cwd(), "src/server/db/migrations");

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

const now = 1_700_000_000_000;

function seed() {
  const d = (id: string, name: string) =>
    sqlite
      .prepare("insert into divisions (id, code, name, is_active, created_at, updated_at) values (?,?,?,1,?,?)")
      .run(id, id.toUpperCase(), name, now, now);

  d("d-evt", "Event");
  d("d-ops", "Operations");
  d("d-cre", "Creative");

  const u = (id: string, role: string) =>
    sqlite
      .prepare(
        "insert into users (id,name,email,password_hash,role,primary_division_id,must_change_password,is_active,created_at,updated_at) values (?,?,?,?,?,?,0,1,?,?)",
      )
      .run(id, id, `${id}@x.test`, "hash", role, "d-evt", now, now);

  u("u-multi", "user"); // belongs to 3 divisions -> fan-out bait
  u("u-crew", "user");
  u("u-mgr", "manager");
  u("u-admin", "admin");
  u("u-corp", "corporate");

  sqlite.prepare("insert into user_divisions values (?,?,1)").run("u-multi", "d-evt");
  sqlite.prepare("insert into user_divisions values (?,?,0)").run("u-multi", "d-ops");
  sqlite.prepare("insert into user_divisions values (?,?,0)").run("u-multi", "d-cre");
  sqlite.prepare("insert into user_divisions values (?,?,1)").run("u-crew", "d-evt");
  sqlite.prepare("insert into user_divisions values (?,?,1)").run("u-mgr", "d-evt");
  sqlite.prepare("insert into user_divisions values (?,?,1)").run("u-admin", "d-evt");
  sqlite.prepare("insert into user_divisions values (?,?,1)").run("u-corp", "d-cre");

  const p = (id: string, owner: string, status = "active") =>
    sqlite
      .prepare(
        "insert into projects (id,code,name,venue,start_date,end_date,timezone,owner_division_id,status,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(id, id.toUpperCase(), id, "Venue", "2026-11-02", "2026-11-02", "Asia/Jakarta", owner, status, now, now);

  p("p-evt", "d-evt");
  p("p-ops", "d-ops");
  p("p-cre", "d-cre");
  p("p-arch", "d-evt", "archived");

  // p-cre is also shared with d-evt as an additional division
  sqlite.prepare("insert into project_divisions values (?,?)").run("p-cre", "d-evt");

  sqlite
    .prepare(
      "insert into project_members (project_id,user_id,role_in_project,is_active,created_at) values (?,?,?,1,?)",
    )
    .run("p-ops", "u-crew", "crew", now);

  sqlite
    .prepare(
      "insert into project_members (project_id,user_id,role_in_project,is_active,created_at) values (?,?,?,1,?)",
    )
    .run("p-evt", "u-crew", "lead", now);
}

const asUser = (id: string, role: ActingUser["role"], divisionIds: string[]): ActingUser => ({
  id,
  role,
  divisionIds,
  isActive: true,
});

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS });
  seed();
});

afterEach(() => {
  sqlite.close();
});

describe("visibleProjectIds (§11.7)", () => {
  it("does not duplicate rows for a user in many divisions (fan-out regression)", async () => {
    const ids = await visibleProjectIds(
      db,
      asUser("u-multi", "user", ["d-evt", "d-ops", "d-cre"]),
    );
    // p-evt matches via owner division, p-ops via owner division, p-cre via both
    // owner division and the additional project_divisions row.
    expect(ids.sort()).toEqual(["p-cre", "p-evt", "p-ops"]);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("hides archived projects unless explicitly requested", async () => {
    const u = asUser("u-multi", "user", ["d-evt"]);
    expect(await visibleProjectIds(db, u)).not.toContain("p-arch");
    expect(
      await visibleProjectIds(db, u, { includeArchived: true }),
    ).toContain("p-arch");
  });

  it("membership sees a project from another division", async () => {
    const crew = asUser("u-crew", "user", ["d-evt"]);
    const ids = await visibleProjectIds(db, crew);
    expect(ids).toContain("p-ops"); // member only, division does not match
  });

  it("a user in an unrelated division sees nothing", async () => {
    // The query resolves divisions from `user_divisions`, so the user must be
    // seeded with an unrelated division rather than faking `divisionIds`.
    sqlite
      .prepare("insert into divisions (id, code, name, is_active, created_at, updated_at) values (?,?,?,1,?,?)")
      .run("d-none", "NONE", "Unrelated", now, now);
    sqlite
      .prepare(
        "insert into users (id,name,email,password_hash,role,primary_division_id,must_change_password,is_active,created_at,updated_at) values (?,?,?,?,?,?,0,1,?,?)",
      )
      .run("u-lone", "u-lone", "lone@x.test", "hash", "user", "d-none", now, now);
    sqlite.prepare("insert into user_divisions values (?,?,1)").run("u-lone", "d-none");

    const ids = await visibleProjectIds(db, asUser("u-lone", "user", ["d-none"]));
    expect(ids).toEqual([]);
  });

  it("admin and corporate see all non-archived projects", async () => {
    const admin = await visibleProjectIds(db, asUser("u-admin", "admin", []));
    const corp = await visibleProjectIds(db, asUser("u-corp", "corporate", []));
    expect(admin.sort()).toEqual(["p-cre", "p-evt", "p-ops"]);
    expect(corp.sort()).toEqual(["p-cre", "p-evt", "p-ops"]);
  });
});

describe("loadProjectFacts", () => {
  it("returns divisions, members and leads", async () => {
    const facts = await loadProjectFacts(db, ["p-evt", "p-cre"]);
    const evt = facts.get("p-evt")!;
    expect(evt.ownerDivisionId).toBe("d-evt");
    expect(evt.memberIds).toContain("u-crew");
    expect(evt.leadIds).toContain("u-crew");

    const cre = facts.get("p-cre")!;
    expect(cre.divisionIds).toEqual(["d-evt"]);
  });

  it("ignores inactive members", async () => {
    sqlite.prepare("update project_members set is_active = 0 where project_id = 'p-evt'").run();
    const facts = await loadProjectFacts(db, ["p-evt"]);
    expect(facts.get("p-evt")!.memberIds).toEqual([]);
    expect(facts.get("p-evt")!.leadIds).toEqual([]);
  });
});

describe("reports constraints (schema-level)", () => {
  const mkReport = (id: string, phase: string, status: string, deletedAt: number | null = null) =>
    sqlite
      .prepare(
        "insert into reports (id,project_id,project_day_id,phase,submitted_by,client_submission_id,status,observed_at,deleted_at,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(id, "p-evt", "day1", phase, "u-crew", `cs-${id}`, status, now, deletedAt, now, now);

  beforeEach(() => {
    sqlite
      .prepare(
        "insert into project_days (id,project_id,date,day_type,is_out_of_range,created_at,updated_at) values (?,?,?,?,0,?,?)",
      )
      .run("day1", "p-evt", "2026-11-02", "event", now, now);
  });

  it("rejects a second live submitted opening", () => {
    mkReport("r1", "opening", "submitted");
    expect(() => mkReport("r2", "opening", "submitted")).toThrow(/UNIQUE/);
  });

  it("allows drafts alongside a submitted opening", () => {
    mkReport("r1", "opening", "submitted");
    expect(() => mkReport("r2", "opening", "draft")).not.toThrow();
  });

  it("allows replacing a soft-deleted opening", () => {
    mkReport("r1", "opening", "submitted", now);
    expect(() => mkReport("r2", "opening", "submitted")).not.toThrow();
  });

  it("allows unlimited monitoring reports", () => {
    mkReport("m1", "monitoring", "submitted");
    mkReport("m2", "monitoring", "submitted");
    mkReport("m3", "monitoring", "submitted");
    const n = sqlite
      .prepare("select count(*) c from reports where phase = 'monitoring'")
      .get() as { c: number };
    expect(n.c).toBe(3);
  });
});
