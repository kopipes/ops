import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import {
  getReportForDayPhase,
  isPhaseOverdue,
  saveDraft,
  submitReport,
  validateResults,
  type SubmitInput,
} from "./reports";
import { createProject } from "./projects";
import { syncProjectChecklist } from "./project-checklist";
import { addMember } from "./members";
import { detectImageType, MAX_UPLOAD_BYTES } from "./photos";
import { zonedToUtc } from "@/lib/datetime";
import { DEFAULT_SETTINGS, saveGlobalSettings } from "./app-settings";

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
let itemIds: { id: string; label: string; phase: string }[] = [];

async function setup() {
  const created = await createProject(db, admin, {
    code: "EVT-2026-1000",
    name: "Event Uji",
    venue: "Venue",
    startDate: "2026-11-02",
    endDate: "2026-11-02",
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
  projectId = created.projectId;

  const days = await db.select().from(schema.projectDays).where(eq(schema.projectDays.projectId, projectId));
  dayId = days[0].id;

  await syncProjectChecklist(db, projectId, {
    rows: [
      {
        sourceItemId: null,
        phase: "opening",
        categoryName: "AV",
        label: "Lampu menyala",
        description: null,
        isRequired: true,
        requiresPhoto: false,
        sortOrder: 0,
        isActive: true,
      },
      {
        sourceItemId: null,
        phase: "opening",
        categoryName: "AV",
        label: "Kabel aman",
        description: null,
        isRequired: true,
        requiresPhoto: true,
        sortOrder: 1,
        isActive: true,
      },
      {
        sourceItemId: null,
        phase: "opening",
        categoryName: "AV",
        label: "Item opsional",
        description: null,
        isRequired: false,
        requiresPhoto: false,
        sortOrder: 2,
        isActive: true,
      },
      // monitoring/closing carry their own items; validation only inspects the
      // rows belonging to the phase being submitted.
      {
        sourceItemId: null,
        phase: "monitoring",
        categoryName: "Umum",
        label: "Monitoring cek",
        description: null,
        isRequired: false,
        requiresPhoto: false,
        sortOrder: 3,
        isActive: true,
      },
      {
        sourceItemId: null,
        phase: "closing",
        categoryName: "Umum",
        label: "Closing cek",
        description: null,
        isRequired: false,
        requiresPhoto: false,
        sortOrder: 4,
        isActive: true,
      },
    ],
    actor: admin,
    divisionId: "d-evt",
  });

  const checklist = await db
    .select()
    .from(schema.projectChecklistItems)
    .where(eq(schema.projectChecklistItems.projectId, projectId));
  // Order by phase then sortOrder so indices are deterministic.
  const phaseRank = { opening: 0, monitoring: 1, closing: 2 } as const;
  itemIds = checklist
    .sort((a, b) => phaseRank[a.phase] - phaseRank[b.phase] || a.sortOrder - b.sortOrder)
    .map((c) => ({ id: c.id, label: c.label, phase: c.phase }));

  await addMember(db, admin, projectId, "u-lead", "lead");
  await addMember(db, admin, projectId, "u-crew", "crew");
}

function baseInput(over: Partial<SubmitInput> = {}): SubmitInput {
  const phase = over.phase ?? "opening";

  // Results must belong to the report's own phase — the service filters the
  // checklist by phase, so sending opening answers with a monitoring report is
  // a validation error (correctly).
  const results =
    phase === "opening"
      ? [
          { projectChecklistItemId: itemIds[0].id, result: "ok" as const, note: null, photoIds: [] },
          { projectChecklistItemId: itemIds[1].id, result: "ok" as const, note: null, photoIds: ["p1"] },
        ]
      : [];

  return {
    projectId,
    projectDayId: dayId,
    phase,
    clientSubmissionId: `cs-${Math.random()}`,
    notes: "Semua aman",
    observedAt: now,
    results,
    photoIds: [],
    ...over,
  };
}

/** Creates a fake photo row so photo links have something to update. */
async function seedPhoto(id: string, uploaderId: string) {
  await db.insert(schema.photos).values({
    id,
    ownerType: "report",
    ownerId: uploaderId,
    projectId,
    projectDayId: dayId,
    path: `2026/11/${id}.webp`,
    thumbPath: `2026/11/${id}_thumb.webp`,
    mime: "image/webp",
    width: 100,
    height: 100,
    sizeBytes: 1000,
    source: "camera",
    uploadedBy: uploaderId,
    createdAt: now,
  });
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
  await db.insert(schema.users).values([
    { id: "u-admin", name: "Admin", email: "a@x", passwordHash: "h", role: "admin", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-mgr", name: "Mgr", email: "m@x", passwordHash: "h", role: "manager", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-lead", name: "Lead", email: "l@x", passwordHash: "h", role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-crew", name: "Crew", email: "c@x", passwordHash: "h", role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.userDivisions).values([
    { userId: "u-admin", divisionId: "d-evt", isPrimary: true },
    { userId: "u-mgr", divisionId: "d-evt", isPrimary: true },
    { userId: "u-lead", divisionId: "d-evt", isPrimary: true },
    { userId: "u-crew", divisionId: "d-evt", isPrimary: true },
  ]);

  await setup();
});

afterEach(() => sqlite.close());

describe("validateResults (§4.3 no.3)", () => {
  const rows = [
    { id: "i1", isRequired: true, requiresPhoto: false, label: "A", isActive: true },
    { id: "i2", isRequired: true, requiresPhoto: true, label: "B", isActive: true },
    { id: "i3", isRequired: false, requiresPhoto: false, label: "C", isActive: true },
  ];

  it("accepts a complete answer set", () => {
    expect(
      validateResults(rows, [
        { projectChecklistItemId: "i1", result: "ok", note: null, photoIds: [] },
        { projectChecklistItemId: "i2", result: "ok", note: null, photoIds: ["p"] },
      ]),
    ).toEqual({ ok: true });
  });

  it("rejects a missing required item", () => {
    const res = validateResults(rows, [
      { projectChecklistItemId: "i1", result: "ok", note: null, photoIds: [] },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("B");
  });

  it("allows an unanswered optional item", () => {
    expect(
      validateResults(rows, [
        { projectChecklistItemId: "i1", result: "ok", note: null, photoIds: [] },
        { projectChecklistItemId: "i2", result: "ok", note: null, photoIds: ["p"] },
      ]).ok,
    ).toBe(true);
  });

  it("requires a note for a NOT_OK item", () => {
    const res = validateResults(rows, [
      { projectChecklistItemId: "i1", result: "not_ok", note: "  ", photoIds: [] },
      { projectChecklistItemId: "i2", result: "ok", note: null, photoIds: ["p"] },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("Catatan wajib");
  });

  it("accepts NOT_OK with a note", () => {
    expect(
      validateResults(rows, [
        { projectChecklistItemId: "i1", result: "not_ok", note: "Lampu mati", photoIds: [] },
        { projectChecklistItemId: "i2", result: "ok", note: null, photoIds: ["p"] },
      ]).ok,
    ).toBe(true);
  });

  it("requires a photo when requires_photo is set", () => {
    const res = validateResults(rows, [
      { projectChecklistItemId: "i1", result: "ok", note: null, photoIds: [] },
      { projectChecklistItemId: "i2", result: "ok", note: null, photoIds: [] },
    ]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain("Foto wajib");
  });

  it("rejects an item that does not belong to the project", () => {
    const res = validateResults(rows, [
      { projectChecklistItemId: "stranger", result: "ok", note: null, photoIds: [] },
    ]);
    expect(res.ok).toBe(false);
  });
});

describe("submitReport permissions (§4.6)", () => {
  it("lead may submit opening", async () => {
    const res = await submitReport(db, sqlite, lead, baseInput());
    expect(res.ok).toBe(true);
  });

  it("plain crew cannot submit opening", async () => {
    const res = await submitReport(db, sqlite, crew, baseInput());
    expect(res).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("crew may submit monitoring repeatedly", async () => {
    const a = await submitReport(db, sqlite, crew, baseInput({ phase: "monitoring" }));
    const b = await submitReport(db, sqlite, crew, baseInput({ phase: "monitoring" }));
    expect(a.ok && b.ok).toBe(true);
  });

  it("manager may submit opening", async () => {
    const res = await submitReport(db, sqlite, mgr, baseInput());
    expect(res.ok).toBe(true);
  });
});

describe("submitReport one-per-phase (§4.6)", () => {
  it("rejects a second opening", async () => {
    expect((await submitReport(db, sqlite, lead, baseInput())).ok).toBe(true);
    const second = await submitReport(db, sqlite, lead, baseInput());
    expect(second).toMatchObject({ ok: false, reason: "duplicate_phase" });
  });

  it("enforces the constraint at the DATABASE level too", async () => {
    await submitReport(db, sqlite, lead, baseInput());
    // Bypass the service check entirely — the partial unique index must fire.
    expect(() =>
      sqlite
        .prepare(
          `insert into reports (id, project_id, project_day_id, phase, submitted_by,
             client_submission_id, status, observed_at, submitted_at, is_late, created_at, updated_at)
           values (?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run("raw-1", projectId, dayId, "opening", "u-lead", "raw-cs", "submitted", now, now, 0, now, now),
    ).toThrow(/UNIQUE/);
  });

  it("allows monitoring alongside opening", async () => {
    expect((await submitReport(db, sqlite, lead, baseInput())).ok).toBe(true);
    expect((await submitReport(db, sqlite, crew, baseInput({ phase: "monitoring" }))).ok).toBe(true);
  });

  it("is idempotent for a repeated client_submission_id", async () => {
    const input = baseInput({ clientSubmissionId: "same-key" });
    const first = await submitReport(db, sqlite, lead, input);
    const second = await submitReport(db, sqlite, lead, input);

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.reportId).toBe(first.reportId);
      expect(second.idempotent).toBe(true);
    }
    const rows = await db.select().from(schema.reports);
    expect(rows).toHaveLength(1);
  });
});

describe("submitReport atomicity (§16.5)", () => {
  it("validation rejects an unknown checklist item before any write", async () => {
    const input = baseInput({
      results: [
        { projectChecklistItemId: itemIds[0].id, result: "ok", note: null, photoIds: [] },
        { projectChecklistItemId: "does-not-exist", result: "ok", note: null, photoIds: [] },
      ],
    });

    const res = await submitReport(db, sqlite, lead, input);
    expect(res).toMatchObject({ ok: false, reason: "validation" });
    expect(await db.select().from(schema.reports)).toHaveLength(0);
  });

  it("rolls back the whole submit when a write fails mid-transaction", async () => {
    // A photo whose update violates a foreign key is not possible here, so force
    // the failure with a trigger that aborts on the audit insert (the LAST write).
    sqlite.exec(`
      create trigger fail_audit before insert on audit_logs
      begin
        select raise(abort, 'forced failure');
      end;
    `);

    await expect(submitReport(db, sqlite, lead, baseInput())).rejects.toThrow(/forced failure/);

    // The report and its results were written before the failing statement, so
    // this proves the transaction rolled them back.
    expect(await db.select().from(schema.reports)).toHaveLength(0);
    expect(await db.select().from(schema.reportCheckResults)).toHaveLength(0);

    sqlite.exec("drop trigger fail_audit");
  });

  it("links per-item photos to check results inside the transaction", async () => {
    await seedPhoto("p1", "u-lead");
    const res = await submitReport(db, sqlite, lead, baseInput());
    expect(res.ok).toBe(true);

    const photo = await db.select().from(schema.photos).where(eq(schema.photos.id, "p1")).get();
    expect(photo?.ownerType).toBe("check_result");

    const results = await db.select().from(schema.reportCheckResults);
    expect(photo?.ownerId).toBe(results[1].id);
  });

  it("links report-level photos to the report", async () => {
    await seedPhoto("p2", "u-lead");
    const res = await submitReport(db, sqlite, lead, baseInput({ photoIds: ["p2"] }));
    expect(res.ok).toBe(true);

    const photo = await db.select().from(schema.photos).where(eq(schema.photos.id, "p2")).get();
    expect(photo?.ownerType).toBe("report");
  });

  it("only relinks photos uploaded by the same user", async () => {
    await seedPhoto("p3", "u-crew"); // uploaded by someone else
    await submitReport(db, sqlite, lead, baseInput({ photoIds: ["p3"] }));

    const photo = await db.select().from(schema.photos).where(eq(schema.photos.id, "p3")).get();
    expect(photo?.ownerType).toBe("report"); // unchanged, still owned by uploader id
    expect(photo?.ownerId).toBe("u-crew");
  });

  it("stores the handover note on closing", async () => {
    const res = await submitReport(
      db,
      sqlite,
      lead,
      baseInput({ phase: "closing", handoverNote: "Besok tambah kursi" }),
    );
    expect(res.ok).toBe(true);

    const day = await db.select().from(schema.projectDays).where(eq(schema.projectDays.id, dayId)).get();
    expect(day?.handoverNote).toBe("Besok tambah kursi");
  });
});

describe("is_late (§13.2)", () => {
  it("marks an opening submitted after the window as late", async () => {
    await saveGlobalSettings(db, admin, { ...DEFAULT_SETTINGS, openingWindowEnabled: true });
    // Window ends 11:00 Jakarta = 04:00Z. Submit at 12:00 Jakarta.
    const late = zonedToUtc("2026-11-02", "12:00", "Asia/Jakarta");
    const res = await submitReport(db, sqlite, lead, baseInput({ observedAt: late }));
    // isLate is computed from SERVER time, not observedAt, so this is about
    // whether "now" is past the window for that day's date.
    expect(res.ok).toBe(true);
    if (res.ok) {
      const windowEnd = zonedToUtc("2026-11-02", "11:00", "Asia/Jakarta");
      expect(res.isLate).toBe(Date.now() > windowEnd);
    }
  });

  it("never marks monitoring as late", async () => {
    const res = await submitReport(db, sqlite, crew, baseInput({ phase: "monitoring" }));
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.isLate).toBe(false);
  });

  it("records server submission time for opening and closing with both windows disabled", async () => {
    const serverNow = zonedToUtc("2026-11-03", "15:30", "Asia/Jakarta");
    const clock = vi.spyOn(Date, "now").mockReturnValue(serverNow);
    try {
      await seedPhoto("p1", "u-lead");
      for (const phase of ["opening", "closing"] as const) {
        const res = await submitReport(db, sqlite, lead, baseInput({ phase, clientSubmissionId: `no-window-${phase}`, observedAt: 0, ...(phase === "closing" ? { results: [] } : {}) }));
        expect(res.ok).toBe(true);
        if (!res.ok) throw new Error(res.message);
        expect(res.isLate).toBe(false);
        const stored = await db.select().from(schema.reports).where(eq(schema.reports.id, res.reportId)).get();
        expect(stored?.submittedAt).toBe(serverNow);
        expect(stored?.submittedBy).toBe(lead.id);
        expect(stored?.observedAt).toBe(0);
      }
    } finally { clock.mockRestore(); }
  });

  it("keeps closing lateness enabled independently of opening", async () => {
    await saveGlobalSettings(db, admin, { ...DEFAULT_SETTINGS, openingWindowEnabled: false, closingWindowEnabled: true });
    await seedPhoto("p1", "u-lead");
    const opening = await submitReport(db, sqlite, lead, baseInput());
    const closing = await submitReport(db, sqlite, lead, baseInput({ phase: "closing", clientSubmissionId: "independent-closing", results: [] }));
    expect(opening.ok && opening.isLate).toBe(false);
    expect(closing.ok).toBe(true);
    if (closing.ok) expect(closing.isLate).toBe(Date.now() > zonedToUtc("2026-11-02", "23:59", "Asia/Jakarta"));
  });
});

describe("getReportForDayPhase", () => {
  it("returns the submitted report with its results", async () => {
    await seedPhoto("p1", "u-lead");
    await submitReport(db, sqlite, lead, baseInput());

    const found = await getReportForDayPhase(db, dayId, "opening");
    expect(found).not.toBeNull();
    expect(found!.results).toHaveLength(2);
    expect(found!.submittedByName).toBe("Lead");
    expect(found!.results.map((r) => r.label)).toContain("Lampu menyala");
  });

  it("returns null when nothing is submitted", async () => {
    expect(await getReportForDayPhase(db, dayId, "opening")).toBeNull();
  });

  it("ignores drafts", async () => {
    await db.insert(schema.reports).values({
      id: "draft-1",
      projectId,
      projectDayId: dayId,
      phase: "opening",
      submittedBy: "u-lead",
      clientSubmissionId: "draft-cs",
      status: "draft",
      observedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    expect(await getReportForDayPhase(db, dayId, "opening")).toBeNull();
  });
});

describe("saveDraft", () => {
  it("creates then updates a draft", async () => {
    const a = await saveDraft(db, lead, {
      ...baseInput({ clientSubmissionId: "draft-key" }),
      results: [],
    });
    const b = await saveDraft(db, lead, {
      ...baseInput({ clientSubmissionId: "draft-key", notes: "revisi" }),
      results: [],
    });
    expect(b.reportId).toBe(a.reportId);

    const row = await db.select().from(schema.reports).where(eq(schema.reports.id, a.reportId)).get();
    expect(row?.notes).toBe("revisi");
    expect(row?.status).toBe("draft");
  });

  it("rejects drafts from non-members", async () => {
    await expect(
      saveDraft(db, { id: "u-nobody", role: "user", divisionIds: [], isActive: true }, {
        ...baseInput({ clientSubmissionId: "x" }),
        results: [],
      }),
    ).rejects.toThrow();
  });
});

describe("isPhaseOverdue (§4.2 late badge)", () => {
  it("does not show overdue badges when windows are disabled", () => {
    const project = { openingWindowEnd: "11:00", closingWindowEnd: "23:59", timezone: "Asia/Jakarta" };
    const later = zonedToUtc("2026-11-03", "15:00", project.timezone);
    expect(isPhaseOverdue("opening", "2026-11-02", project, later, DEFAULT_SETTINGS)).toBe(false);
    expect(isPhaseOverdue("closing", "2026-11-02", project, later, DEFAULT_SETTINGS)).toBe(false);
  });
  const project = {
    openingWindowEnd: "11:00",
    closingWindowEnd: "23:59",
    timezone: "Asia/Jakarta",
  };

  it("is not overdue before the window ends", () => {
    const t = zonedToUtc("2026-11-02", "10:00", "Asia/Jakarta");
    expect(isPhaseOverdue("opening", "2026-11-02", project, t)).toBe(false);
  });

  it("is overdue after the window ends", () => {
    const t = zonedToUtc("2026-11-02", "11:30", "Asia/Jakarta");
    expect(isPhaseOverdue("opening", "2026-11-02", project, t)).toBe(true);
  });

  it("monitoring is never overdue", () => {
    const t = zonedToUtc("2026-11-02", "23:00", "Asia/Jakarta");
    expect(isPhaseOverdue("monitoring", "2026-11-02", project, t)).toBe(false);
  });
});

describe("photo validation (§8.3)", () => {
  it("detects JPEG magic bytes", () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageType(buf)).toBe("jpeg");
  });

  it("detects PNG magic bytes", () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(detectImageType(buf)).toBe("png");
  });

  it("detects WebP magic bytes", () => {
    const buf = Buffer.alloc(16);
    buf.write("RIFF", 0, "ascii");
    buf.write("WEBP", 8, "ascii");
    expect(detectImageType(buf)).toBe("webp");
  });

  it("rejects a non-image payload disguised with an image extension", () => {
    const buf = Buffer.from("<?php echo 'pwned'; ?>");
    expect(detectImageType(buf)).toBeNull();
  });

  it("documents the 15 MB per-file limit", () => {
    expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024);
  });
});

describe("phase narrative: Laporan Awal/Akhir Hari", () => {
  it("stores the opening narrative after the checklist", async () => {
    const res = await submitReport(
      db,
      sqlite,
      lead,
      baseInput({ phaseNote: "Area siap, 10 crew hadir, genset siaga." }),
    );
    expect(res.ok).toBe(true);

    const row = await db.select().from(schema.reports).where(eq(schema.reports.id, (res as { reportId: string }).reportId)).get();
    expect(row?.phaseNote).toBe("Area siap, 10 crew hadir, genset siaga.");
  });

  it("stores the closing narrative separately from the handover note", async () => {
    const res = await submitReport(
      db,
      sqlite,
      lead,
      baseInput({
        phase: "closing",
        phaseNote: "Semua area bersih, 2 issue tersisa.",
        handoverNote: "Vendor lighting datang jam 9",
      }),
    );
    expect(res.ok).toBe(true);

    const row = await db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, (res as { reportId: string }).reportId))
      .get();
    expect(row?.phaseNote).toBe("Semua area bersih, 2 issue tersisa.");

    // The handover lives on the DAY, not the report — they must not collide.
    const day = await db.select().from(schema.projectDays).where(eq(schema.projectDays.id, dayId)).get();
    expect(day?.handoverNote).toBe("Vendor lighting datang jam 9");
  });

  it("exposes the narrative through getReportForDayPhase", async () => {
    await submitReport(db, sqlite, lead, baseInput({ phaseNote: "Catatan awal hari" }));
    const found = await getReportForDayPhase(db, dayId, "opening");
    expect(found?.phaseNote).toBe("Catatan awal hari");
  });

  it("is optional — submit still succeeds without it", async () => {
    const res = await submitReport(db, sqlite, lead, baseInput({ phaseNote: null }));
    expect(res.ok).toBe(true);
  });

  it("monitoring reports carry no phase narrative", async () => {
    const res = await submitReport(
      db,
      sqlite,
      crew,
      baseInput({ phase: "monitoring", phaseNote: null }),
    );
    expect(res.ok).toBe(true);
    const row = await db
      .select()
      .from(schema.reports)
      .where(eq(schema.reports.id, (res as { reportId: string }).reportId))
      .get();
    expect(row?.phaseNote).toBeNull();
  });
});
