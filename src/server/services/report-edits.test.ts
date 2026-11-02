import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import {
  applyReportEdit,
  computeChanges,
  getEditLabel,
  getEditableReport,
  listReportRevisions,
} from "./report-edits";
import { createProject, setProjectStatus } from "./projects";
import { syncProjectChecklist } from "./project-checklist";
import { addMember } from "./members";
import { submitReport } from "./reports";
import { markDayReviewed } from "./reports-review";

const MIGRATIONS = resolve(process.cwd(), "src/server/db/migrations");
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = 1_700_000_000_000;

const admin: ActingUser = { id: "u-admin", role: "admin", divisionIds: ["d-evt"], isActive: true };
const mgr: ActingUser = { id: "u-mgr", role: "manager", divisionIds: ["d-evt"], isActive: true };
const lead: ActingUser = { id: "u-lead", role: "user", divisionIds: ["d-evt"], isActive: true };
const crew: ActingUser = { id: "u-crew", role: "user", divisionIds: ["d-evt"], isActive: true };

let projectId: string;
let dayId: string;
let itemIds: string[] = [];
let reportId: string;

async function setupReport() {
  const created = await createProject(db, admin, {
    code: "EVT-2026-0001",
    name: "P",
    venue: "V",
    // Use today so the H+1 12:00 edit window is still open for the author.
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    timezone: "Asia/Jakarta",
    ownerDivisionId: "d-evt",
    additionalDivisionIds: [],
    openingWindowStart: "00:00",
    openingWindowEnd: "23:58",
    closingWindowStart: "00:00",
    closingWindowEnd: "23:59",
    saveAsDraft: false,
    checklistSource: "empty",
    templateIds: [],
    sourceProjectId: null,
    checklistItems: [],
    members: [],
  });
  projectId = created.projectId;

  const days = await db.select().from(schema.projectDays).where(eq(schema.projectDays.projectId, projectId));
  dayId = days[0].id;

  await syncProjectChecklist(db, projectId, {
    rows: [
      { sourceItemId: null, phase: "opening", categoryName: "AV", label: "Lampu", description: null, isRequired: true, requiresPhoto: false, sortOrder: 0, isActive: true },
      { sourceItemId: null, phase: "opening", categoryName: "AV", label: "Kabel", description: null, isRequired: true, requiresPhoto: false, sortOrder: 1, isActive: true },
    ],
    actor: admin,
    divisionId: "d-evt",
  });

  const items = await db
    .select()
    .from(schema.projectChecklistItems)
    .where(eq(schema.projectChecklistItems.projectId, projectId))
    .orderBy(schema.projectChecklistItems.sortOrder);
  itemIds = items.map((i) => i.id);

  await addMember(db, admin, projectId, "u-lead", "lead");
  await addMember(db, admin, projectId, "u-crew", "crew");

  const res = await submitReport(db, sqlite, lead, {
    projectId,
    projectDayId: dayId,
    phase: "opening",
    clientSubmissionId: "cs-1",
    notes: "awal",
    observedAt: Date.now(),
    results: [
      { projectChecklistItemId: itemIds[0], result: "ok", note: null, photoIds: [] },
      { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
    ],
    photoIds: [],
  });
  if (!res.ok) throw new Error("submit failed");
  reportId = res.reportId;
}

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
  const pw = "h";
  await db.insert(schema.users).values([
    { id: "u-admin", name: "Admin", email: "a@x", passwordHash: pw, role: "admin", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-mgr", name: "Rina S.", email: "m@x", passwordHash: pw, role: "manager", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-lead", name: "Budi", email: "l@x", passwordHash: pw, role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-crew", name: "Crew", email: "c@x", passwordHash: pw, role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.userDivisions).values([
    { userId: "u-admin", divisionId: "d-evt", isPrimary: true },
    { userId: "u-mgr", divisionId: "d-evt", isPrimary: true },
    { userId: "u-lead", divisionId: "d-evt", isPrimary: true },
    { userId: "u-crew", divisionId: "d-evt", isPrimary: true },
  ]);

  await setupReport();
});

afterEach(() => sqlite.close());

describe("computeChanges", () => {
  const before = [
    { projectChecklistItemId: "i1", label: "A", result: "ok", note: null },
    { projectChecklistItemId: "i2", label: "B", result: "not_ok", note: "rusak" },
  ];

  it("detects a result change", () => {
    const changes = computeChanges(before, [
      { projectChecklistItemId: "i1", result: "not_ok", note: null, photoIds: [] },
      { projectChecklistItemId: "i2", result: "not_ok", note: "rusak", photoIds: [] },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: "result", from: "ok", to: "not_ok", label: "A" });
  });

  it("detects a note change", () => {
    const changes = computeChanges(before, [
      { projectChecklistItemId: "i1", result: "ok", note: null, photoIds: [] },
      { projectChecklistItemId: "i2", result: "not_ok", note: "sudah diperbaiki", photoIds: [] },
    ]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: "note", from: "rusak", to: "sudah diperbaiki" });
  });

  it("returns nothing when unchanged", () => {
    expect(
      computeChanges(before, [
        { projectChecklistItemId: "i1", result: "ok", note: null, photoIds: [] },
        { projectChecklistItemId: "i2", result: "not_ok", note: "rusak", photoIds: [] },
      ]),
    ).toEqual([]);
  });
});

describe("getEditableReport", () => {
  it("returns the report with its results", async () => {
    const loaded = await getEditableReport(db, lead, reportId);
    expect(loaded?.report.results).toHaveLength(2);
    expect(loaded?.report.submittedByName).toBe("Budi");
    expect(loaded?.report.editCount).toBe(0);
  });

  it("author may edit within the window", async () => {
    const loaded = await getEditableReport(db, lead, reportId);
    expect(loaded?.canEdit).toBe(true);
  });

  it("another crew member may not edit", async () => {
    const loaded = await getEditableReport(db, crew, reportId);
    expect(loaded?.canEdit).toBe(false);
  });

  it("manager may edit", async () => {
    const loaded = await getEditableReport(db, mgr, reportId);
    expect(loaded?.canEdit).toBe(true);
  });

  it("blocks editing once the day is reviewed (§13.1)", async () => {
    await markDayReviewed(db, mgr, dayId);
    const loaded = await getEditableReport(db, lead, reportId);
    expect(loaded?.canEdit).toBe(false);
    expect(loaded?.editBlockedReason).toMatch(/direview/);
  });

  it("returns null for a report that does not exist", async () => {
    expect(await getEditableReport(db, lead, "nope")).toBeNull();
  });
});

describe("applyReportEdit (§9.5 no.4)", () => {
  it("writes a revision snapshot before applying the change", async () => {
    await applyReportEdit(db, sqlite, lead, reportId, {
      notes: "diperbaiki",
      results: [
        { projectChecklistItemId: itemIds[0], result: "not_ok", note: "lampu mati", photoIds: [] },
        { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
      ],
    });

    const revisions = await listReportRevisions(db, reportId);
    expect(revisions).toHaveLength(1);
    // The snapshot holds the PREVIOUS values.
    expect(revisions[0].snapshot.notes).toBe("awal");
    expect(revisions[0].snapshot.results.find((r) => r.label === "Lampu")?.result).toBe("ok");

    // And the diff records what changed.
    expect(revisions[0].changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "result", from: "ok", to: "not_ok" }),
      ]),
    );
  });

  it("updates the live report", async () => {
    await applyReportEdit(db, sqlite, lead, reportId, {
      notes: "diperbaiki",
      results: [
        { projectChecklistItemId: itemIds[0], result: "not_ok", note: "lampu mati", photoIds: [] },
        { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
      ],
    });

    const loaded = await getEditableReport(db, lead, reportId);
    expect(loaded?.report.notes).toBe("diperbaiki");
    expect(loaded?.report.results.find((r) => r.label === "Lampu")?.result).toBe("not_ok");
  });

  it("increments the edit count and exposes the editor", async () => {
    await applyReportEdit(db, sqlite, lead, reportId, {
      notes: "v2",
      results: [
        { projectChecklistItemId: itemIds[0], result: "ok", note: null, photoIds: [] },
        { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
      ],
    });

    const loaded = await getEditableReport(db, lead, reportId);
    expect(loaded?.report.editCount).toBe(1);
    expect(loaded?.report.lastEditedByName).toBe("Budi");
  });

  it("requires a note for a NOT OK answer", async () => {
    await expect(
      applyReportEdit(db, sqlite, lead, reportId, {
        notes: "x",
        results: [
          { projectChecklistItemId: itemIds[0], result: "not_ok", note: "", photoIds: [] },
          { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
        ],
      }),
    ).rejects.toThrow(/Catatan wajib/);
  });

  it("rejects a no-op edit", async () => {
    await expect(
      applyReportEdit(db, sqlite, lead, reportId, {
        notes: "awal",
        results: [
          { projectChecklistItemId: itemIds[0], result: "ok", note: null, photoIds: [] },
          { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
        ],
      }),
    ).rejects.toThrow(/Tidak ada perubahan/);
  });

  it("refuses to edit a reviewed day", async () => {
    await markDayReviewed(db, mgr, dayId);
    await expect(
      applyReportEdit(db, sqlite, lead, reportId, {
        notes: "terlambat",
        results: [
          { projectChecklistItemId: itemIds[0], result: "not_ok", note: "x", photoIds: [] },
          { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
        ],
      }),
    ).rejects.toThrow(/direview/);
  });

  it("refuses an edit by an unrelated crew member", async () => {
    await expect(
      applyReportEdit(db, sqlite, crew, reportId, {
        notes: "nakal",
        results: [
          { projectChecklistItemId: itemIds[0], result: "not_ok", note: "x", photoIds: [] },
          { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
        ],
      }),
    ).rejects.toThrow();
  });

  it("writes an audit log entry", async () => {
    await applyReportEdit(db, sqlite, lead, reportId, {
      notes: "audit",
      results: [
        { projectChecklistItemId: itemIds[0], result: "ok", note: null, photoIds: [] },
        { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
      ],
    });
    const logs = await db.select().from(schema.auditLogs);
    expect(logs.some((l) => l.action === "report.edited")).toBe(true);
  });

  it("keeps multiple revisions in order", async () => {
    for (const note of ["v2", "v3"]) {
      await applyReportEdit(db, sqlite, lead, reportId, {
        notes: note,
        results: [
          { projectChecklistItemId: itemIds[0], result: "ok", note: null, photoIds: [] },
          { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
        ],
      });
    }
    const revisions = await listReportRevisions(db, reportId);
    expect(revisions.map((r) => r.snapshot.notes)).toEqual(["awal", "v2"]);
  });
});

describe("getEditLabel", () => {
  it("returns null before any edit", async () => {
    expect(await getEditLabel(db, reportId)).toBeNull();
  });

  it("returns the last editor after an edit", async () => {
    await applyReportEdit(db, sqlite, lead, reportId, {
      notes: "baru",
      results: [
        { projectChecklistItemId: itemIds[0], result: "ok", note: null, photoIds: [] },
        { projectChecklistItemId: itemIds[1], result: "ok", note: null, photoIds: [] },
      ],
    });
    const label = await getEditLabel(db, reportId);
    expect(label?.editedByName).toBe("Budi");
  });
});

describe("closed projects still allow report edits before review", () => {
  it("completed project does not block the edit window itself", async () => {
    await setProjectStatus(db, admin, projectId, "completed");
    const loaded = await getEditableReport(db, lead, reportId);
    // The review flag, not the project status, governs §13.1.
    expect(loaded?.canEdit).toBe(true);
  });
});
