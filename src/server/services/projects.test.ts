import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import {
  autoCompleteExpiredProjects,
  createProject,
  generateProjectCode,
  listProjectDays,
  setProjectStatus,
  syncProjectDays,
  updateProject,
} from "./projects";
import {
  buildChecklistFromProject,
  buildChecklistFromTemplates,
  listProjectChecklist,
  syncProjectChecklist,
} from "./project-checklist";
import { addMember, listMemberCandidates, listMembers, removeMember, setMemberRole, setMembers } from "./members";
import type { ProjectInput } from "@/lib/schemas";

const MIGRATIONS = resolve(process.cwd(), "src/server/db/migrations");

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = 1_700_000_000_000;

const admin: ActingUser = { id: "u-admin", role: "admin", divisionIds: ["d-evt"], isActive: true };
const mgr: ActingUser = { id: "u-mgr", role: "manager", divisionIds: ["d-evt"], isActive: true };
const mgrOther: ActingUser = { id: "u-mgr2", role: "manager", divisionIds: ["d-ops"], isActive: true };
const crew: ActingUser = { id: "u-crew", role: "user", divisionIds: ["d-evt"], isActive: true };
const crewOps: ActingUser = { id: "u-crew2", role: "user", divisionIds: ["d-ops"], isActive: true };

function projectInput(over: Partial<ProjectInput> = {}): ProjectInput {
  return {
    code: "EVT-2026-0001",
    name: "Pameran Otomotif",
    venue: "JCC Senayan",
    startDate: "2026-11-02",
    endDate: "2026-11-04",
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
  await db.insert(schema.users).values([
    { id: "u-admin", name: "Admin", email: "a@x", passwordHash: "h", role: "admin", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-mgr", name: "Mgr", email: "m@x", passwordHash: "h", role: "manager", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-mgr2", name: "Mgr2", email: "m2@x", passwordHash: "h", role: "manager", primaryDivisionId: "d-ops", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-crew", name: "Crew", email: "c@x", passwordHash: "h", role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-crew2", name: "CrewOps", email: "c2@x", passwordHash: "h", role: "user", primaryDivisionId: "d-ops", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.userDivisions).values([
    { userId: "u-admin", divisionId: "d-evt", isPrimary: true },
    { userId: "u-mgr", divisionId: "d-evt", isPrimary: true },
    { userId: "u-mgr2", divisionId: "d-ops", isPrimary: true },
    { userId: "u-crew", divisionId: "d-evt", isPrimary: true },
    { userId: "u-crew2", divisionId: "d-ops", isPrimary: true },
  ]);
});

afterEach(() => sqlite.close());

describe("project code generation (§6.1)", () => {
  it("starts at 0001 then increments", async () => {
    expect(await generateProjectCode(db, { divisionCode: "EVT", year: 2026 })).toBe("EVT-2026-0001");

    await createProject(db, admin, projectInput({ code: "EVT-2026-0001" }));
    expect(await generateProjectCode(db, { divisionCode: "EVT", year: 2026 })).toBe("EVT-2026-0002");
  });

  it("is scoped per division and year", async () => {
    await createProject(db, admin, projectInput({ code: "EVT-2026-0001" }));
    expect(await generateProjectCode(db, { divisionCode: "OPS", year: 2026 })).toBe("OPS-2026-0001");
    expect(await generateProjectCode(db, { divisionCode: "EVT", year: 2027 })).toBe("EVT-2027-0001");
  });

  it("pads to 4 digits", async () => {
    const code = await generateProjectCode(db, { divisionCode: "EVT", year: 2026 });
    expect(code.slice(-4)).toBe("0001");
  });
});

describe("project_days generation (§11.3)", () => {
  it("creates one day per date inclusive", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const days = await listProjectDays(db, projectId);
    expect(days.map((d) => d.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  it("handles a single-day project", async () => {
    const { projectId } = await createProject(
      db,
      admin,
      projectInput({ startDate: "2026-11-02", endDate: "2026-11-02" }),
    );
    expect(await listProjectDays(db, projectId)).toHaveLength(1);
  });

  it("inserts only new days when the range widens", async () => {
    const { projectId } = await createProject(db, admin, projectInput());

    const res = await syncProjectDays(db, projectId, {
      startDate: "2026-11-02",
      endDate: "2026-11-06",
    });
    expect(res.inserted).toBe(2);
    expect(res.deleted).toBe(0);

    const days = await listProjectDays(db, projectId);
    expect(days).toHaveLength(5);
  });

  it("prepends new days when the start moves earlier", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const res = await syncProjectDays(db, projectId, {
      startDate: "2026-10-31",
      endDate: "2026-11-04",
    });
    expect(res.inserted).toBe(2);
    const days = await listProjectDays(db, projectId);
    expect(days[0].date).toBe("2026-10-31");
  });

  it("is idempotent when nothing changes", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const res = await syncProjectDays(db, projectId, {
      startDate: "2026-11-02",
      endDate: "2026-11-04",
    });
    expect(res).toMatchObject({ inserted: 0, deleted: 0, flaggedOutOfRange: 0 });
  });

  it("deletes an empty day when the range shrinks", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const res = await syncProjectDays(db, projectId, {
      startDate: "2026-11-02",
      endDate: "2026-11-02",
    });
    expect(res.deleted).toBe(2);
    expect(await listProjectDays(db, projectId)).toHaveLength(1);
  });

  it("keeps and flags a day that already has a report (never deletes data)", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const days = await listProjectDays(db, projectId);
    const lastDay = days[days.length - 1];

    await db.insert(schema.reports).values({
      id: "r1",
      projectId,
      projectDayId: lastDay.id,
      phase: "opening",
      submittedBy: "u-crew",
      clientSubmissionId: "cs-1",
      status: "submitted",
      observedAt: now,
      submittedAt: now,
      isLate: false,
      createdAt: now,
      updatedAt: now,
    });

    const res = await syncProjectDays(db, projectId, {
      startDate: "2026-11-02",
      endDate: "2026-11-02",
    });

    expect(res.flaggedOutOfRange).toBe(1);
    expect(res.keptWithData).toEqual(["2026-11-04"]);

    const after = await listProjectDays(db, projectId);
    const kept = after.find((d) => d.date === "2026-11-04");
    expect(kept).toBeDefined();
    expect(kept!.isOutOfRange).toBe(true);

    // The report survived.
    const reports = await db.select().from(schema.reports);
    expect(reports).toHaveLength(1);
  });

  it("clears the out-of-range flag when the day is back inside", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const days = await listProjectDays(db, projectId);
    await db.insert(schema.reports).values({
      id: "r1",
      projectId,
      projectDayId: days[2].id,
      phase: "opening",
      submittedBy: "u-crew",
      clientSubmissionId: "cs-1",
      status: "submitted",
      observedAt: now,
      submittedAt: now,
      isLate: false,
      createdAt: now,
      updatedAt: now,
    });

    await syncProjectDays(db, projectId, { startDate: "2026-11-02", endDate: "2026-11-02" });
    await syncProjectDays(db, projectId, { startDate: "2026-11-02", endDate: "2026-11-04" });

    const after = await listProjectDays(db, projectId);
    expect(after.find((d) => d.date === "2026-11-04")!.isOutOfRange).toBe(false);
  });
});

describe("createProject", () => {
  it("creates an active project by default", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const p = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    expect(p?.status).toBe("active");
  });

  it("creates a draft when requested", async () => {
    const { projectId } = await createProject(db, admin, projectInput({ saveAsDraft: true }));
    const p = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    expect(p?.status).toBe("draft");
  });

  it("uppercases the code", async () => {
    const { projectId } = await createProject(db, admin, projectInput({ code: "evt-2026-0009" }));
    const p = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    expect(p?.code).toBe("EVT-2026-0009");
  });

  it("rejects a duplicate code", async () => {
    await createProject(db, admin, projectInput());
    await expect(createProject(db, admin, projectInput())).rejects.toThrow(/sudah dipakai/);
  });

  it("manager cannot create a project for another division", async () => {
    await expect(
      createProject(db, mgr, projectInput({ ownerDivisionId: "d-ops" })),
    ).rejects.toThrow(/divisimu/);
  });

  it("crew cannot create projects at all", async () => {
    await expect(createProject(db, crew, projectInput())).rejects.toThrow();
  });

  it("stores additional divisions", async () => {
    const { projectId } = await createProject(
      db,
      admin,
      projectInput({ additionalDivisionIds: ["d-ops"] }),
    );
    const divs = await db
      .select()
      .from(schema.projectDivisions)
      .where(eq(schema.projectDivisions.projectId, projectId));
    expect(divs.map((d) => d.divisionId)).toEqual(["d-ops"]);
  });
});

describe("updateProject date rules (§11.3)", () => {
  it("refuses date changes on a completed project", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await setProjectStatus(db, admin, projectId, "completed");

    await expect(
      updateProject(db, admin, projectId, projectInput({ endDate: "2026-11-09" })),
    ).rejects.toThrow(/Tanggal tidak bisa diubah/);
  });

  it("allows non-date edits on a completed project", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await setProjectStatus(db, admin, projectId, "completed");

    await expect(
      updateProject(db, admin, projectId, projectInput({ name: "Nama Baru" })),
    ).resolves.toBeDefined();
  });

  it("only admin may change the owner division", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await expect(
      updateProject(db, mgr, projectId, projectInput({ ownerDivisionId: "d-ops" })),
    ).rejects.toThrow(/Admin/);
    await expect(
      updateProject(db, admin, projectId, projectInput({ ownerDivisionId: "d-ops" })),
    ).resolves.toBeDefined();
  });

  it("extending dates creates the new days", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const res = await updateProject(db, admin, projectId, projectInput({ endDate: "2026-11-05" }));
    expect(res.datesChanged).toBe(true);
    expect(res.days.inserted).toBe(1);
  });
});

describe("status flow (§6.2)", () => {
  it("follows draft -> active -> completed -> archived", async () => {
    const { projectId } = await createProject(db, admin, projectInput({ saveAsDraft: true }));
    await setProjectStatus(db, admin, projectId, "active");
    await setProjectStatus(db, admin, projectId, "completed");
    await setProjectStatus(db, admin, projectId, "archived");

    const p = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    expect(p?.status).toBe("archived");
  });

  it("rejects an illegal transition", async () => {
    const { projectId } = await createProject(db, admin, projectInput({ saveAsDraft: true }));
    await expect(setProjectStatus(db, admin, projectId, "completed")).rejects.toThrow(
      /Tidak bisa mengubah status/,
    );
  });

  it("requires a reason to reopen a completed project", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await setProjectStatus(db, admin, projectId, "completed");
    await expect(setProjectStatus(db, admin, projectId, "active")).rejects.toThrow(/Alasan wajib/);
    await expect(
      setProjectStatus(db, admin, projectId, "active", "Ada laporan susulan"),
    ).resolves.toBeUndefined();
  });

  it("auto-completes projects past their end date (H+1)", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const done = await autoCompleteExpiredProjects(db, now, () => "2026-11-05");
    expect(done).toContain(projectId);
  });

  it("does not complete a project still running", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const done = await autoCompleteExpiredProjects(db, now, () => "2026-11-04");
    expect(done).not.toContain(projectId);
  });
});

describe("checklist snapshot (§5.3)", () => {
  let templateA: string;
  let templateB: string;
  let itemCommon: string;
  let itemA: string;
  let itemB: string;

  beforeEach(async () => {
    await db.insert(schema.checklistCategories).values({
      id: "c1",
      name: "AV/Sound",
      sortOrder: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    itemCommon = "i-common";
    itemA = "i-a";
    itemB = "i-b";
    await db.insert(schema.checklistItems).values([
      { id: itemCommon, label: "Common item", phase: "opening", categoryId: "c1", isRequired: true, requiresPhoto: false, isActive: true, sortOrder: 0, createdAt: now, updatedAt: now },
      { id: itemA, label: "Only A", phase: "opening", categoryId: "c1", isRequired: true, requiresPhoto: false, isActive: true, sortOrder: 1, createdAt: now, updatedAt: now },
      { id: itemB, label: "Only B", phase: "closing", categoryId: "c1", isRequired: false, requiresPhoto: true, isActive: true, sortOrder: 2, createdAt: now, updatedAt: now },
    ]);
    templateA = "t-a";
    templateB = "t-b";
    await db.insert(schema.checklistTemplates).values([
      { id: templateA, name: "A", isActive: true, createdAt: now, updatedAt: now },
      { id: templateB, name: "B", isActive: true, createdAt: now, updatedAt: now },
    ]);
    await db.insert(schema.checklistTemplateItems).values([
      { templateId: templateA, checklistItemId: itemCommon, sortOrder: 0 },
      { templateId: templateA, checklistItemId: itemA, sortOrder: 1 },
      { templateId: templateB, checklistItemId: itemCommon, sortOrder: 0 }, // duplicate across templates
      { templateId: templateB, checklistItemId: itemB, sortOrder: 1 },
    ]);
  });

  it("merges two templates without duplicates (§14 AC)", async () => {
    const rows = await buildChecklistFromTemplates(db, [templateA, templateB]);
    const ids = rows.map((r) => r.sourceItemId);
    expect(ids).toEqual([itemCommon, itemA, itemB]);
    expect(new Set(ids).size).toBe(3);
  });

  it("preserves the selected template order", async () => {
    const rows = await buildChecklistFromTemplates(db, [templateB, templateA]);
    expect(rows.map((r) => r.sourceItemId)).toEqual([itemCommon, itemB, itemA]);
  });

  it("applies template overrides into the snapshot", async () => {
    await db
      .update(schema.checklistTemplateItems)
      .set({ isRequiredOverride: false })
      .where(eq(schema.checklistTemplateItems.checklistItemId, itemA));
    const rows = await buildChecklistFromTemplates(db, [templateA]);
    expect(rows.find((r) => r.sourceItemId === itemA)?.isRequired).toBe(false);
  });

  it("copies a previous project's checklist without duplicates", async () => {
    const { projectId } = await createProject(db, admin, projectInput({ code: "SRC-1" }));
    await syncProjectChecklist(db, projectId, {
      rows: await buildChecklistFromTemplates(db, [templateA, templateB]),
      actor: admin,
      divisionId: "d-evt",
    });

    const rows = await buildChecklistFromProject(db, projectId);
    expect(rows).toHaveLength(3);
  });

  it("inserts snapshot rows", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const res = await syncProjectChecklist(db, projectId, {
      rows: await buildChecklistFromTemplates(db, [templateA, templateB]),
      actor: admin,
      divisionId: "d-evt",
    });
    expect(res.inserted).toBe(3);
    expect(await listProjectChecklist(db, projectId)).toHaveLength(3);
  });

  it("deactivating an item in the project hides it but keeps the row", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await syncProjectChecklist(db, projectId, {
      rows: await buildChecklistFromTemplates(db, [templateA, templateB]),
      actor: admin,
      divisionId: "d-evt",
    });

    const res = await syncProjectChecklist(db, projectId, {
      rows: (await buildChecklistFromTemplates(db, [templateA])),
      actor: admin,
      divisionId: "d-evt",
    });
    expect(res.deactivated).toBe(1);
    expect(await listProjectChecklist(db, projectId)).toHaveLength(2);

    const all = await listProjectChecklist(db, projectId, { includeInactive: true });
    expect(all).toHaveLength(3);
  });

  it("NEVER alters a submitted report when the checklist changes (§5.3 no.5)", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await syncProjectChecklist(db, projectId, {
      rows: await buildChecklistFromTemplates(db, [templateA, templateB]),
      actor: admin,
      divisionId: "d-evt",
    });

    const days = await listProjectDays(db, projectId);
    const snapshot = await listProjectChecklist(db, projectId);
    const target = snapshot.find((s) => s.label === "Only B")!;

    // A submitted report with results referencing those snapshot rows.
    await db.insert(schema.reports).values({
      id: "rep1",
      projectId,
      projectDayId: days[0].id,
      phase: "opening",
      submittedBy: "u-crew",
      clientSubmissionId: "cs-rep1",
      status: "submitted",
      observedAt: now,
      submittedAt: now,
      isLate: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.reportCheckResults).values({
      id: "rcr1",
      reportId: "rep1",
      projectChecklistItemId: target.id,
      result: "ok",
      createdAt: now,
    });

    // Now the manager removes that item from the project checklist.
    const res = await syncProjectChecklist(db, projectId, {
      rows: await buildChecklistFromTemplates(db, [templateA]),
      actor: admin,
      divisionId: "d-evt",
    });

    // It is frozen: still active, so the submitted report renders identically.
    expect(res.keptFrozen).toBe(1);
    const after = await listProjectChecklist(db, projectId);
    expect(after.find((s) => s.id === target.id)).toBeDefined();

    // And the result row is untouched.
    const results = await db
      .select()
      .from(schema.reportCheckResults)
      .where(eq(schema.reportCheckResults.id, "rcr1"));
    expect(results).toHaveLength(1);
    expect(results[0].result).toBe("ok");
  });

  it("updates an existing row in place, preserving its id", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await syncProjectChecklist(db, projectId, {
      rows: await buildChecklistFromTemplates(db, [templateA]),
      actor: admin,
      divisionId: "d-evt",
    });
    const before = await listProjectChecklist(db, projectId);

    const edited = before.map((r) => ({ ...r, label: `${r.label} (rev)` }));
    await syncProjectChecklist(db, projectId, { rows: edited, actor: admin, divisionId: "d-evt" });

    const after = await listProjectChecklist(db, projectId);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after[0].label).toContain("(rev)");
  });

  it("promotes custom items to master when asked (§5.3 no.3)", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    const res = await syncProjectChecklist(db, projectId, {
      rows: [
        {
          sourceItemId: null,
          phase: "opening",
          categoryName: "AV/Sound",
          label: "Custom promoted",
          description: null,
          isRequired: true,
          requiresPhoto: false,
          sortOrder: 0,
          isActive: true,
        },
      ],
      saveCustomToMaster: true,
      actor: admin,
      divisionId: "d-evt",
    });
    expect(res.inserted).toBe(1);

    const master = await db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.label, "Custom promoted"));
    expect(master).toHaveLength(1);
    expect(master[0].sourceProjectId).toBe(projectId);

    // The snapshot row now points at the promoted master item.
    const snap = await listProjectChecklist(db, projectId);
    expect(snap[0].sourceItemId).toBe(master[0].id);
  });
});

describe("members (§6.1 no.4)", () => {
  it("adds a member and lists them", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await addMember(db, admin, projectId, "u-crew", "crew");
    const members = await listMembers(db, projectId);
    expect(members).toHaveLength(1);
    expect(members[0].roleInProject).toBe("crew");
  });

  it("rejects adding an inactive user", async () => {
    await db.update(schema.users).set({ isActive: false }).where(eq(schema.users.id, "u-crew"));
    const { projectId } = await createProject(db, admin, projectInput());
    await expect(addMember(db, admin, projectId, "u-crew", "crew")).rejects.toThrow(/nonaktif/);
  });

  it("flags cross-division members", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await addMember(db, admin, projectId, "u-crew2", "crew"); // d-ops onto a d-evt project
    const members = await listMembers(db, projectId);
    expect(members[0].isCrossDivision).toBe(true);
  });

  it("soft-removes a member", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await addMember(db, admin, projectId, "u-crew", "crew");
    await removeMember(db, admin, projectId, "u-crew");

    expect(await listMembers(db, projectId)).toHaveLength(0);
    const raw = await db.select().from(schema.projectMembers);
    expect(raw).toHaveLength(1);
    expect(raw[0].isActive).toBe(false);
  });

  it("promotes a member to lead (Head Crew)", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await addMember(db, admin, projectId, "u-crew", "crew");
    await setMemberRole(db, admin, projectId, "u-crew", "lead");

    const members = await listMembers(db, projectId);
    expect(members[0].roleInProject).toBe("lead");
  });

  it("manager from another division cannot assign members", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await expect(addMember(db, mgrOther, projectId, "u-crew2", "crew")).rejects.toThrow();
  });

  it("crew cannot assign members", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await expect(addMember(db, crew, projectId, "u-crew", "crew")).rejects.toThrow();
  });

  it("setMembers replaces the list and deactivates the rest", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await addMember(db, admin, projectId, "u-crew", "crew");
    await addMember(db, admin, projectId, "u-crew2", "crew");

    await setMembers(db, admin, projectId, [{ userId: "u-crew", roleInProject: "lead" }]);

    const members = await listMembers(db, projectId);
    expect(members).toHaveLength(1);
    expect(members[0].roleInProject).toBe("lead");
  });

  it("excludes existing members from the candidate list", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await addMember(db, admin, projectId, "u-crew", "crew");

    const candidates = await listMemberCandidates(db, projectId);
    expect(candidates.map((c) => c.userId)).not.toContain("u-crew");
    expect(candidates.some((c) => c.inProjectDivision)).toBe(true);
  });
});

describe("duplicate snapshot rows (regression)", () => {
  let catId: string;
  let masterId: string;

  beforeEach(async () => {
    await db.insert(schema.checklistCategories).values({
      id: "cat-dup",
      name: "AV",
      sortOrder: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    catId = "cat-dup";
    masterId = "master-dup";
    await db.insert(schema.checklistItems).values({
      id: masterId,
      label: "Sama",
      phase: "opening",
      categoryId: catId,
      isRequired: true,
      requiresPhoto: false,
      isActive: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    });
  });

  const row = () => ({
    sourceItemId: masterId,
    phase: "opening" as const,
    categoryName: "AV",
    label: "Sama",
    description: null,
    isRequired: true,
    requiresPhoto: false,
    sortOrder: 0,
    isActive: true,
  });

  it("does not insert a duplicate when syncing the same row twice", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await syncProjectChecklist(db, projectId, { rows: [row()], actor: admin, divisionId: "d-evt" });
    await syncProjectChecklist(db, projectId, { rows: [row()], actor: admin, divisionId: "d-evt" });

    expect(await listProjectChecklist(db, projectId)).toHaveLength(1);
  });

  it("collapses pre-existing duplicate rows instead of leaving both active", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await syncProjectChecklist(db, projectId, { rows: [row()], actor: admin, divisionId: "d-evt" });

    // Simulate the historical bug: a second active row with the same source item.
    await db.insert(schema.projectChecklistItems).values({
      id: "dup-extra",
      projectId,
      sourceItemId: masterId,
      phase: "opening",
      categoryName: "AV",
      label: "Sama",
      isRequired: true,
      requiresPhoto: false,
      sortOrder: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    expect(await listProjectChecklist(db, projectId)).toHaveLength(2);

    const res = await syncProjectChecklist(db, projectId, {
      rows: [row()],
      actor: admin,
      divisionId: "d-evt",
    });

    // Exactly one remains active; the stray was deactivated, not deleted.
    expect(await listProjectChecklist(db, projectId)).toHaveLength(1);
    expect(res.deactivated).toBe(1);
    expect(
      await listProjectChecklist(db, projectId, { includeInactive: true }),
    ).toHaveLength(2);
  });

  it("keeps rows frozen by submitted results even when collapsing duplicates", async () => {
    const { projectId } = await createProject(db, admin, projectInput());
    await syncProjectChecklist(db, projectId, { rows: [row()], actor: admin, divisionId: "d-evt" });

    await db.insert(schema.projectChecklistItems).values({
      id: "dup-frozen",
      projectId,
      sourceItemId: masterId,
      phase: "opening",
      categoryName: "AV",
      label: "Sama",
      isRequired: true,
      requiresPhoto: false,
      sortOrder: 1,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    // A submitted report references the duplicate.
    const days = await listProjectDays(db, projectId);
    await db.insert(schema.reports).values({
      id: "rep-dup",
      projectId,
      projectDayId: days[0].id,
      phase: "opening",
      submittedBy: "u-crew",
      clientSubmissionId: "cs-dup",
      status: "submitted",
      observedAt: now,
      submittedAt: now,
      isLate: false,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.reportCheckResults).values({
      id: "rcr-dup",
      reportId: "rep-dup",
      projectChecklistItemId: "dup-frozen",
      result: "ok",
      createdAt: now,
    });

    await syncProjectChecklist(db, projectId, { rows: [row()], actor: admin, divisionId: "d-evt" });

    // The referenced result row must still resolve to an existing checklist row.
    const all = await listProjectChecklist(db, projectId, { includeInactive: true });
    expect(all.find((r) => r.id === "dup-frozen")).toBeDefined();
  });
});
