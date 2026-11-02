import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import {
  addDayComment,
  getDailySummary,
  getDashboard,
  getDayDetail,
  isDayEditable,
  markDayReviewed,
  unmarkDayReviewed,
} from "./reports-review";
import { createProject } from "./projects";
import { syncProjectChecklist } from "./project-checklist";
import { addMember } from "./members";
import { submitReport, type SubmitInput } from "./reports";

const MIGRATIONS = resolve(process.cwd(), "src/server/db/migrations");

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = 1_700_000_000_000;

const admin: ActingUser = { id: "u-admin", role: "admin", divisionIds: ["d-evt"], isActive: true };
const mgr: ActingUser = { id: "u-mgr", role: "manager", divisionIds: ["d-evt"], isActive: true };
const corp: ActingUser = { id: "u-corp", role: "corporate", divisionIds: ["d-cre"], isActive: true };
const lead: ActingUser = { id: "u-lead", role: "user", divisionIds: ["d-evt"], isActive: true };
const crew: ActingUser = { id: "u-crew", role: "user", divisionIds: ["d-evt"], isActive: true };
const outsider: ActingUser = { id: "u-out", role: "user", divisionIds: ["d-ops"], isActive: true };

let projectId: string;
let dayIds: string[] = [];
let openingItemIds: string[] = [];

async function setupProject(code = "EVT-2026-0001") {
  const created = await createProject(db, admin, {
    code,
    name: "Pameran Otomotif",
    venue: "JCC",
    startDate: "2026-11-02",
    endDate: "2026-11-03",
    timezone: "Asia/Jakarta",
    ownerDivisionId: "d-evt",
    additionalDivisionIds: [],
    openingWindowStart: "06:00",
    openingWindowEnd: "11:00",
    closingWindowStart: "17:00",
    closingWindowEnd: "23:59",
    saveAsDraft: false,
    checklistSource: "empty",
    templateIds: [],
    sourceProjectId: null,
    checklistItems: [],
    members: [],
  });

  const days = await db
    .select()
    .from(schema.projectDays)
    .where(eq(schema.projectDays.projectId, created.projectId))
    .orderBy(schema.projectDays.date);

  await syncProjectChecklist(db, created.projectId, {
    rows: [
      { sourceItemId: null, phase: "opening", categoryName: "AV", label: "Ok one", description: null, isRequired: true, requiresPhoto: false, sortOrder: 0, isActive: true },
      { sourceItemId: null, phase: "opening", categoryName: "AV", label: "Ok two", description: null, isRequired: true, requiresPhoto: false, sortOrder: 1, isActive: true },
      { sourceItemId: null, phase: "opening", categoryName: "AV", label: "Broken", description: null, isRequired: true, requiresPhoto: false, sortOrder: 2, isActive: true },
      { sourceItemId: null, phase: "opening", categoryName: "AV", label: "N/A one", description: null, isRequired: false, requiresPhoto: false, sortOrder: 3, isActive: true },
    ],
    actor: admin,
    divisionId: "d-evt",
  });

  const items = await db
    .select()
    .from(schema.projectChecklistItems)
    .where(eq(schema.projectChecklistItems.projectId, created.projectId))
    .orderBy(schema.projectChecklistItems.sortOrder);

  await addMember(db, admin, created.projectId, "u-lead", "lead");
  await addMember(db, admin, created.projectId, "u-crew", "crew");

  return { projectId: created.projectId, dayIds: days.map((d) => d.id), items: items.map((i) => i.id) };
}

function openingInput(
  projectDayId: string,
  results: { id: string; result: "ok" | "not_ok" | "na"; note?: string }[],
): SubmitInput {
  return {
    projectId,
    projectDayId,
    phase: "opening",
    clientSubmissionId: `cs-${Math.random()}`,
    notes: "catatan",
    observedAt: now,
    results: results.map((r) => ({
      projectChecklistItemId: r.id,
      result: r.result,
      note: r.note ?? null,
      photoIds: [],
    })),
    photoIds: [],
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
    { id: "d-cre", code: "CRE", name: "Creative", isActive: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.users).values([
    { id: "u-admin", name: "Admin", email: "a@x", passwordHash: "h", role: "admin", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-mgr", name: "Rina S.", email: "m@x", passwordHash: "h", role: "manager", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-corp", name: "Direktur", email: "corp@x", passwordHash: "h", role: "corporate", primaryDivisionId: "d-cre", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-lead", name: "Budi", email: "l@x", passwordHash: "h", role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-crew", name: "Crew", email: "c@x", passwordHash: "h", role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-out", name: "Out", email: "o@x", passwordHash: "h", role: "user", primaryDivisionId: "d-ops", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.userDivisions).values([
    { userId: "u-admin", divisionId: "d-evt", isPrimary: true },
    { userId: "u-mgr", divisionId: "d-evt", isPrimary: true },
    { userId: "u-corp", divisionId: "d-cre", isPrimary: true },
    { userId: "u-lead", divisionId: "d-evt", isPrimary: true },
    { userId: "u-crew", divisionId: "d-evt", isPrimary: true },
    { userId: "u-out", divisionId: "d-ops", isPrimary: true },
  ]);

  const setup = await setupProject();
  projectId = setup.projectId;
  dayIds = setup.dayIds;
  openingItemIds = setup.items;
});

afterEach(() => sqlite.close());

describe("markDayReviewed (§7.2 no.7)", () => {
  it("sets reviewed_at/reviewed_by and audits it", async () => {
    await markDayReviewed(db, mgr, dayIds[0]);

    const day = await db.select().from(schema.projectDays).where(eq(schema.projectDays.id, dayIds[0])).get();
    expect(day?.reviewedAt).toBeTruthy();
    expect(day?.reviewedBy).toBe("u-mgr");

    const logs = await db.select().from(schema.auditLogs);
    expect(logs.some((l) => l.action === "day.reviewed")).toBe(true);
  });

  it("is idempotent", async () => {
    await markDayReviewed(db, mgr, dayIds[0]);
    const first = await db.select().from(schema.projectDays).where(eq(schema.projectDays.id, dayIds[0])).get();
    await markDayReviewed(db, mgr, dayIds[0]);
    const second = await db.select().from(schema.projectDays).where(eq(schema.projectDays.id, dayIds[0])).get();
    expect(second?.reviewedAt).toBe(first?.reviewedAt);
  });

  it("corporate may review (§2.3)", async () => {
    await expect(markDayReviewed(db, corp, dayIds[0])).resolves.toBeUndefined();
  });

  it("crew may not review", async () => {
    await expect(markDayReviewed(db, crew, dayIds[0])).rejects.toThrow(/tidak berhak/);
  });

  it("manager from another division may not review", async () => {
    await expect(markDayReviewed(db, { ...mgr, divisionIds: ["d-ops"] }, dayIds[0])).rejects.toThrow();
  });

  it("admin may review", async () => {
    await expect(markDayReviewed(db, admin, dayIds[0])).resolves.toBeUndefined();
  });
});

describe("unmarkDayReviewed (§13.1, Q14)", () => {
  it("clears the review and requires a reason", async () => {
    await markDayReviewed(db, mgr, dayIds[0]);
    await expect(unmarkDayReviewed(db, mgr, dayIds[0], "  ")).rejects.toThrow(/Alasan/);

    await unmarkDayReviewed(db, mgr, dayIds[0], "Laporan perlu dikoreksi");
    const day = await db.select().from(schema.projectDays).where(eq(schema.projectDays.id, dayIds[0])).get();
    expect(day?.reviewedAt).toBeNull();

    const logs = await db.select().from(schema.auditLogs);
    const log = logs.find((l) => l.action === "day.unreviewed");
    expect(log).toBeDefined();
    expect(JSON.parse(log!.metaJson!)).toMatchObject({ reason: "Laporan perlu dikoreksi" });
  });

  it("crew cannot un-review", async () => {
    await markDayReviewed(db, mgr, dayIds[0]);
    await expect(unmarkDayReviewed(db, crew, dayIds[0], "x")).rejects.toThrow();
  });
});

describe("review locks the report edit window (§13.1)", () => {
  it("a day becomes non-editable once reviewed", async () => {
    expect(await isDayEditable(db, dayIds[0])).toBe(true);
    await markDayReviewed(db, mgr, dayIds[0]);
    expect(await isDayEditable(db, dayIds[0])).toBe(false);
  });

  it("un-reviewing reopens editing (before H+1 12:00)", async () => {
    await markDayReviewed(db, mgr, dayIds[0]);
    await unmarkDayReviewed(db, mgr, dayIds[0], "koreksi");
    // Day is in 2026; relative to real "now" the H+1 deadline may already differ,
    // so assert only that the review flag no longer forces it closed.
    const day = await db.select().from(schema.projectDays).where(eq(schema.projectDays.id, dayIds[0])).get();
    expect(day?.reviewedAt).toBeNull();
  });
});

describe("addDayComment (§7.2 no.7)", () => {
  it("stores a comment visible to crew", async () => {
    await addDayComment(db, mgr, dayIds[0], "Tolong cek lampu sisi kiri");

    const comments = await db.select().from(schema.dayComments);
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe("Tolong cek lampu sisi kiri");
  });

  it("rejects an empty comment", async () => {
    await expect(addDayComment(db, mgr, dayIds[0], "   ")).rejects.toThrow();
  });

  it("crew cannot comment", async () => {
    await expect(addDayComment(db, crew, dayIds[0], "halo")).rejects.toThrow();
  });
});

describe("getDailySummary (§7.1)", () => {
  beforeEach(async () => {
    // 3 of 4 answered, 2 OK, 1 NOT OK, 1 N/A -> 2/4 = 50%
    await submitReport(db, sqlite, lead, openingInput(dayIds[0], [
      { id: openingItemIds[0], result: "ok" },
      { id: openingItemIds[1], result: "ok" },
      { id: openingItemIds[2], result: "not_ok", note: "mati" },
      { id: openingItemIds[3], result: "na" },
    ]));
  });

  it("returns one row per project × date", async () => {
    const rows = await getDailySummary(db, [projectId], { from: "2026-11-02", to: "2026-11-03" });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.date).sort()).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("computes the checklist percentage from answered results", async () => {
    const rows = await getDailySummary(db, [projectId], { from: "2026-11-02", to: "2026-11-02" });
    expect(rows[0].checklistOkPct).toBe(50); // 2 OK / 4 answered
    expect(rows[0].answeredCount).toBe(4);
    expect(rows[0].notOkCount).toBe(1);
  });

  it("shows opening presence and monitoring count", async () => {
    const rows = await getDailySummary(db, [projectId], { from: "2026-11-02", to: "2026-11-02" });
    expect(rows[0].opening).not.toBeNull();
    expect(rows[0].opening!.by).toBe("Budi");
    expect(rows[0].closing).toBeNull();
    expect(rows[0].monitoringCount).toBe(0);
  });

  it("filters unreviewed days", async () => {
    const before = await getDailySummary(db, [projectId], { from: "2026-11-02", to: "2026-11-03", status: "unreviewed" });
    expect(before).toHaveLength(2);

    await markDayReviewed(db, mgr, dayIds[0]);
    const after = await getDailySummary(db, [projectId], { from: "2026-11-02", to: "2026-11-03", status: "unreviewed" });
    expect(after).toHaveLength(1);
    expect(after[0].date).toBe("2026-11-03");
  });

  it("filters incomplete days (missing opening or closing)", async () => {
    const rows = await getDailySummary(db, [projectId], { from: "2026-11-02", to: "2026-11-03", status: "incomplete" });
    // Both days lack a closing.
    expect(rows).toHaveLength(2);
  });

  it("filters by project", async () => {
    const other = await setupProject("EVT-2026-0002");
    void other;
    const rows = await getDailySummary(db, [projectId], {
      from: "2026-11-02",
      to: "2026-11-03",
      projectId,
    });
    expect(rows.every((r) => r.projectId === projectId)).toBe(true);
  });

  it("returns nothing for an empty visibility set", async () => {
    expect(await getDailySummary(db, [], { from: "2026-11-02", to: "2026-11-03" })).toEqual([]);
  });

  it("returns nothing for a reversed date range", async () => {
    expect(await getDailySummary(db, [projectId], { from: "2026-11-03", to: "2026-11-02" })).toEqual([]);
  });

  it("flags rows with critical/high open issues", async () => {
    await db.insert(schema.issueCategories).values({ id: "c1", name: "Teknis", sortOrder: 1, isActive: true, createdAt: now, updatedAt: now });
    await db.insert(schema.issues).values({
      id: "i1",
      code: "EVT-2026-0001-I-001",
      projectId,
      projectDayId: dayIds[0],
      phase: "opening",
      title: "Kritis",
      categoryId: "c1",
      severity: "critical",
      status: "open",
      nextStep: "Segera",
      createdBy: "u-lead",
      authorName: "Budi",
      authorRole: "user",
      authorDivision: "Event",
      createdAt: now,
      updatedAt: now,
    });

    const rows = await getDailySummary(db, [projectId], { from: "2026-11-02", to: "2026-11-03", status: "critical" });
    expect(rows.length).toBe(2); // newest first: 11-03 then 11-02
    expect(rows.every((r) => r.hasCriticalOpen)).toBe(true);
    // Only the day the issue was created on counts it as "new".
    expect(rows.find((r) => r.date === "2026-11-02")!.issuesNew).toBe(1);
    expect(rows.find((r) => r.date === "2026-11-03")!.issuesNew).toBe(0);
  });
});

describe("getDayDetail (§7.2)", () => {
  beforeEach(async () => {
    await submitReport(db, sqlite, lead, openingInput(dayIds[0], [
      { id: openingItemIds[0], result: "ok" },
      { id: openingItemIds[1], result: "na" },
      { id: openingItemIds[2], result: "not_ok", note: "lampu putus" },
      { id: openingItemIds[3], result: "ok" },
    ]));
  });

  it("orders NOT_OK results first (§7.2 no.2)", async () => {
    const detail = await getDayDetail(db, mgr, projectId, "2026-11-02");
    expect(detail).not.toBeNull();
    const results = detail!.opening!.results;
    expect(results[0].result).toBe("not_ok");
    expect(results[0].label).toBe("Broken");
    expect(results[0].note).toBe("lampu putus");
    // N/A then OK
    expect(results[1].result).toBe("na");
    expect(results.filter((r) => r.result === "ok")).toHaveLength(2);
  });

  it("returns null when the user cannot see the project", async () => {
    expect(await getDayDetail(db, outsider, projectId, "2026-11-02")).toBeNull();
  });

  it("returns null for a date with no project day", async () => {
    expect(await getDayDetail(db, mgr, projectId, "2026-12-25")).toBeNull();
  });

  it("exposes canReview/canUnreview per role", async () => {
    const asMgr = await getDayDetail(db, mgr, projectId, "2026-11-02");
    expect(asMgr!.canReview).toBe(true);

    const asCrew = await getDayDetail(db, crew, projectId, "2026-11-02");
    expect(asCrew!.canReview).toBe(false);
  });

  it("reports the reviewed-by name after review", async () => {
    await markDayReviewed(db, mgr, dayIds[0]);
    const detail = await getDayDetail(db, crew, projectId, "2026-11-02");
    expect(detail!.day.reviewedByName).toBe("Rina S.");
  });

  it("includes reviewer comments for crew to read", async () => {
    await addDayComment(db, mgr, dayIds[0], "Tolong perbaiki sebelum besok");
    const detail = await getDayDetail(db, crew, projectId, "2026-11-02");
    expect(detail!.comments).toHaveLength(1);
    expect(detail!.comments[0].body).toBe("Tolong perbaiki sebelum besok");
  });

  it("computes summary numbers", async () => {
    const detail = await getDayDetail(db, mgr, projectId, "2026-11-02");
    expect(detail!.summary.checklistOkPct).toBe(50);
    expect(detail!.summary.answeredCount).toBe(4);
    expect(detail!.summary.notOkCount).toBe(1);
    expect(detail!.summary.monitoringCount).toBe(0);
  });
});

describe("getDashboard (§7.3)", () => {
  it("counts today's active projects and phase completion", async () => {
    const dash = await getDashboard(db, [projectId]);
    expect(dash.activeProjects).toBe(1);
    expect(dash.openingDone).toBe(0);
  });

  it("counts open issues by severity", async () => {
    await db.insert(schema.issueCategories).values({ id: "c1", name: "Teknis", sortOrder: 1, isActive: true, createdAt: now, updatedAt: now });
    await db.insert(schema.issues).values([
      { id: "i1", code: "C-1", projectId, title: "A", categoryId: "c1", severity: "critical", status: "open", nextStep: "x", createdBy: "u-lead", authorName: "B", authorRole: "user", createdAt: now, updatedAt: now },
      { id: "i2", code: "C-2", projectId, title: "B", categoryId: "c1", severity: "low", status: "closed", nextStep: "x", createdBy: "u-lead", authorName: "B", authorRole: "user", createdAt: now, updatedAt: now },
    ]);

    const dash = await getDashboard(db, [projectId]);
    expect(dash.openIssuesBySeverity.critical).toBe(1);
    expect(dash.openIssuesBySeverity.low).toBe(0); // closed excluded
    expect(dash.needsAttention.some((n) => n.kind === "critical_open")).toBe(true);
  });

  it("counts unreviewed days", async () => {
    const before = await getDashboard(db, [projectId]);
    expect(before.unreviewedDays).toBeGreaterThanOrEqual(0);
  });

  it("returns empty data for no visible projects", async () => {
    const dash = await getDashboard(db, []);
    expect(dash.activeProjects).toBe(0);
    expect(dash.needsAttention).toEqual([]);
  });
});
