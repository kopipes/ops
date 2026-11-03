import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import {
  addIssueComment,
  changeIssueStatus,
  createIssue,
  diffIssue,
  generateIssueCode,
  getIssueDetail,
  listCarryOverIssues,
  listIssues,
  softDeleteIssue,
  updateIssueFields,
} from "./issues";
import { createProject } from "./projects";
import { addMember } from "./members";
import type { IssueInput } from "@/lib/schemas";

const MIGRATIONS = resolve(process.cwd(), "src/server/db/migrations");

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = 1_700_000_000_000;

const admin: ActingUser = { id: "u-admin", role: "admin", divisionIds: ["d-evt"], isActive: true };
const mgr: ActingUser = { id: "u-mgr", role: "manager", divisionIds: ["d-evt"], isActive: true };
const mgrOther: ActingUser = { id: "u-mgr2", role: "manager", divisionIds: ["d-ops"], isActive: true };
const crew: ActingUser = { id: "u-crew", role: "user", divisionIds: ["d-evt"], isActive: true };
const outsider: ActingUser = { id: "u-out", role: "user", divisionIds: ["d-ops"], isActive: true };

let projectId: string;
let dayId: string;
let categoryId = "cat-teknis";

async function seedPhoto(id: string, uploaderId: string, proj = projectId) {
  await db.insert(schema.photos).values({
    id,
    ownerType: "report",
    ownerId: uploaderId,
    projectId: proj,
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

function issueInput(over: Partial<IssueInput> = {}): IssueInput {
  return {
    projectId,
    projectDayId: dayId,
    phase: "opening",
    title: "Lampu panggung mati",
    description: "Lampu sisi kiri tidak menyala",
    categoryId,
    severity: "high",
    nextStep: "Hubungi vendor lighting",
    picUserId: "u-crew",
    picExternal: undefined,
    dueAt: undefined,
    photoIds: ["ph-1"],
    checkResultId: null,
    reportId: null,
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
    { id: "u-mgr", name: "Rina S.", email: "m@x", passwordHash: "h", role: "manager", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-mgr2", name: "Mgr2", email: "m2@x", passwordHash: "h", role: "manager", primaryDivisionId: "d-ops", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-crew", name: "Budi", email: "c@x", passwordHash: "h", role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
    { id: "u-out", name: "Out", email: "o@x", passwordHash: "h", role: "user", primaryDivisionId: "d-ops", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.userDivisions).values([
    { userId: "u-admin", divisionId: "d-evt", isPrimary: true },
    { userId: "u-mgr", divisionId: "d-evt", isPrimary: true },
    { userId: "u-mgr2", divisionId: "d-ops", isPrimary: true },
    { userId: "u-crew", divisionId: "d-evt", isPrimary: true },
    { userId: "u-out", divisionId: "d-ops", isPrimary: true },
  ]);
  await db.insert(schema.issueCategories).values({
    id: categoryId,
    name: "Teknis",
    sortOrder: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const created = await createProject(db, admin, {
    code: "EVT-2026-0012",
    name: "Pameran Otomotif",
    venue: "JCC",
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
  });
  projectId = created.projectId;
  const days = await db.select().from(schema.projectDays).where(eq(schema.projectDays.projectId, projectId));
  dayId = days[0].id;

  await addMember(db, admin, projectId, "u-crew", "crew");
  await seedPhoto("ph-1", "u-crew");
});

afterEach(() => sqlite.close());

describe("issue code (§9.5 no.8)", () => {
  it("generates project-scoped sequential codes", async () => {
    expect(await generateIssueCode(db, projectId)).toBe("EVT-2026-0012-I-001");
    await createIssue(db, crew, issueInput());
    expect(await generateIssueCode(db, projectId)).toBe("EVT-2026-0012-I-002");
  });

  it("uses the project code as the prefix", async () => {
    const { code } = await createIssue(db, crew, issueInput());
    expect(code).toBe("EVT-2026-0012-I-001");
  });
});

describe("createIssue (§4.7)", () => {
  it("creates an open issue with an identity snapshot", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    const row = await db.select().from(schema.issues).where(eq(schema.issues.id, issueId)).get();

    expect(row?.status).toBe("open");
    // §9.5 no.2: snapshot, not a join.
    expect(row?.authorName).toBe("Budi");
    expect(row?.authorRole).toBe("user");
    expect(row?.authorDivision).toBe("Event");
  });

  it("writes a 'created' timeline entry", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    const updates = await db.select().from(schema.issueUpdates).where(eq(schema.issueUpdates.issueId, issueId));

    expect(updates).toHaveLength(1);
    expect(updates[0].action).toBe("created");
    expect(updates[0].statusTo).toBe("open");
  });

  it("requires at least one photo (§4.7 [ASUMSI])", async () => {
    await expect(createIssue(db, crew, issueInput({ photoIds: [] }))).rejects.toThrow(/foto/i);
  });

  it("rejects a photo belonging to another user", async () => {
    await seedPhoto("ph-other", "u-mgr");
    await expect(
      createIssue(db, crew, issueInput({ photoIds: ["ph-other"] })),
    ).rejects.toThrow(/user lain/);
  });

  it("rejects a photo from another project", async () => {
    const other = await createProject(db, admin, {
      code: "EVT-2026-0099",
      name: "Other",
      venue: "V",
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
    await seedPhoto("ph-elsewhere", "u-crew", other.projectId);
    await expect(
      createIssue(db, crew, issueInput({ photoIds: ["ph-elsewhere"] })),
    ).rejects.toThrow(/project lain/);
  });

  it("rejects a PIC who is not a project member", async () => {
    await expect(
      createIssue(db, crew, issueInput({ picUserId: "u-out" })),
    ).rejects.toThrow(/member project/);
  });

  it("allows an external PIC by free text", async () => {
    const { issueId } = await createIssue(
      db,
      crew,
      issueInput({ picUserId: undefined, picExternal: "Vendor ABC" }),
    );
    const row = await db.select().from(schema.issues).where(eq(schema.issues.id, issueId)).get();
    expect(row?.picExternal).toBe("Vendor ABC");
    expect(row?.picUserId).toBeNull();
  });

  it("attaches photos to the issue", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    const p = await db.select().from(schema.photos).where(eq(schema.photos.id, "ph-1")).get();
    expect(p?.ownerType).toBe("issue");
    expect(p?.ownerId).toBe(issueId);
  });

  it("outsider cannot create an issue (§2.2)", async () => {
    await expect(createIssue(db, outsider, issueInput())).rejects.toThrow();
  });

  it("manager can create an issue without a report (§4.7)", async () => {
    await seedPhoto("ph-mgr", "u-mgr");
    await expect(
      createIssue(db, mgr, issueInput({ photoIds: ["ph-mgr"] })),
    ).resolves.toBeDefined();
  });
});

describe("diffIssue (§9.5 no.3)", () => {
  it("returns only changed fields as [old, new]", () => {
    const changes = diffIssue(
      { severity: "medium", title: "A", status: "open" },
      { severity: "high", title: "A", status: "open" },
    );
    expect(changes).toEqual({ severity: ["medium", "high"] });
  });

  it("returns an empty object when nothing changed", () => {
    expect(diffIssue({ title: "A" }, { title: "A" })).toEqual({});
  });

  it("normalises undefined to null", () => {
    const changes = diffIssue({ pic_external: undefined }, { pic_external: null });
    expect(changes).toEqual({});
  });
});

describe("updateIssueFields", () => {
  it("records a diff of exactly the changed fields", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await seedPhoto("ph-mgr2", "u-mgr");
    const res = await updateIssueFields(db, mgr, issueId, {
      ...issueInput({ photoIds: ["ph-mgr2"] }),
      severity: "critical",
      nextStep: "Ganti lampu hari ini",
    });

    expect(res.changed).toBe(true);
    expect(res.changes).toEqual({
      severity: ["high", "critical"],
      next_step: ["Hubungi vendor lighting", "Ganti lampu hari ini"],
    });

    const updates = await db.select().from(schema.issueUpdates).where(eq(schema.issueUpdates.issueId, issueId));
    const edit = updates.find((u) => u.action === "edited");
    expect(edit).toBeDefined();
    expect(JSON.parse(edit!.changesJson!)).toEqual(res.changes);
  });

  it("writes no timeline entry when nothing changed", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    // Pass no photos: re-sending the already-attached photo would be "photo_added".
    const res = await updateIssueFields(db, crew, issueId, { ...issueInput(), photoIds: [] });
    expect(res.changed).toBe(false);

    const updates = await db.select().from(schema.issueUpdates).where(eq(schema.issueUpdates.issueId, issueId));
    expect(updates).toHaveLength(1); // still only "created"
  });

  it("logs added photos as a separate action", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await seedPhoto("ph-2", "u-crew");

    await updateIssueFields(db, crew, issueId, { ...issueInput(), photoIds: ["ph-2"] });

    const updates = await db.select().from(schema.issueUpdates).where(eq(schema.issueUpdates.issueId, issueId));
    expect(updates.some((u) => u.action === "photo_added")).toBe(true);
  });

  it("outsider cannot edit", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await expect(
      updateIssueFields(db, outsider, issueId, issueInput({ title: "Hacked" })),
    ).rejects.toThrow();
  });
});

describe("status lifecycle (§4.7)", () => {
  it("crew may move open -> in_progress -> resolved", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await changeIssueStatus(db, crew, issueId, "in_progress", "Vendor dihubungi");
    await changeIssueStatus(db, crew, issueId, "resolved");

    const row = await db.select().from(schema.issues).where(eq(schema.issues.id, issueId)).get();
    expect(row?.status).toBe("resolved");
    expect(row?.resolvedBy).toBe("u-crew");
  });

  it("crew may NOT set Closed (§2.3)", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await expect(changeIssueStatus(db, crew, issueId, "closed")).rejects.toThrow(/Manager atau Admin/);
  });

  it("manager may close", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await changeIssueStatus(db, mgr, issueId, "closed", "Selesai ditangani");

    const row = await db.select().from(schema.issues).where(eq(schema.issues.id, issueId)).get();
    expect(row?.status).toBe("closed");
    expect(row?.closedBy).toBe("u-mgr");
  });

  it("manager may reopen a closed issue", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await changeIssueStatus(db, mgr, issueId, "closed");
    await changeIssueStatus(db, mgr, issueId, "open", "Masalah muncul lagi");

    const updates = await db.select().from(schema.issueUpdates).where(eq(schema.issueUpdates.issueId, issueId));
    expect(updates.some((u) => u.action === "reopened")).toBe(true);
  });

  it("crew may NOT reopen a closed issue", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await changeIssueStatus(db, mgr, issueId, "closed");
    await expect(changeIssueStatus(db, crew, issueId, "open")).rejects.toThrow();
  });

  it("every status change appends exactly one timeline entry", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await changeIssueStatus(db, crew, issueId, "in_progress");
    await changeIssueStatus(db, crew, issueId, "resolved");
    await changeIssueStatus(db, mgr, issueId, "closed");

    const updates = await db.select().from(schema.issueUpdates).where(eq(schema.issueUpdates.issueId, issueId));
    expect(updates).toHaveLength(4); // created + 3 changes
    const changes = updates.filter((u) => u.action === "status_changed");
    expect(changes).toHaveLength(3);
    expect(JSON.parse(changes[2].changesJson!)).toEqual({ status: ["resolved", "closed"] });
  });

  it("rejects a same-status change without writing a row", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await changeIssueStatus(db, crew, issueId, "open");
    const updates = await db.select().from(schema.issueUpdates).where(eq(schema.issueUpdates.issueId, issueId));
    expect(updates).toHaveLength(1);
  });
});

describe("append-only timeline (§9.5 no.3)", () => {
  it("stores a snapshot that survives a user rename and role change", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await changeIssueStatus(db, crew, issueId, "in_progress", "Mulai dikerjakan");

    // The user changes their name, role and division afterwards.
    await db
      .update(schema.users)
      .set({ name: "Budi Santoso", role: "manager", primaryDivisionId: "d-ops" })
      .where(eq(schema.users.id, "u-crew"));

    const detail = await getIssueDetail(db, admin, issueId);
    expect(detail!.issue.authorName).toBe("Budi"); // snapshot preserved
    expect(detail!.timeline[0].authorName).toBe("Budi");
    expect(detail!.timeline[1].authorName).toBe("Budi");
    expect(detail!.timeline[1].authorRole).toBe("user");
  });

  it("has no API to mutate or delete a timeline row", async () => {
    // The service module must not export update/delete helpers for issue_updates.
    const mod = await import("./issues");
    const names = Object.keys(mod);
    expect(names).not.toContain("updateIssueUpdate");
    expect(names).not.toContain("deleteIssueUpdate");
    expect(names).not.toContain("editIssueUpdate");
  });

  it("keeps all entries in chronological order", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await changeIssueStatus(db, crew, issueId, "in_progress");
    await addIssueComment(db, crew, issueId, "Teknisi datang");
    await changeIssueStatus(db, crew, issueId, "resolved");

    const detail = await getIssueDetail(db, admin, issueId);
    const times = detail!.timeline.map((t) => t.createdAt);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });
});

describe("comments", () => {
  it("appends a comment with photo", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await seedPhoto("ph-3", "u-crew");
    await addIssueComment(db, crew, issueId, "Foto kondisi terbaru", ["ph-3"]);

    const detail = await getIssueDetail(db, admin, issueId);
    const comment = detail!.timeline.find((t) => t.action === "comment");
    expect(comment?.note).toBe("Foto kondisi terbaru");
    expect(comment?.photos).toHaveLength(1);
  });

  it("outsider cannot comment", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await expect(addIssueComment(db, outsider, issueId, "Halo")).rejects.toThrow();
  });
});

describe("soft delete (§9.5 no.6)", () => {
  it("requires a reason", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await expect(softDeleteIssue(db, mgr, issueId, "  ")).rejects.toThrow(/Alasan/);
  });

  it("crew cannot delete", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await expect(softDeleteIssue(db, crew, issueId, "Salah input")).rejects.toThrow(/Manager atau Admin/);
  });

  it("manager deletion is soft, keeps the row and writes an audit log", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await softDeleteIssue(db, mgr, issueId, "Duplikat issue");

    const raw = sqlite
      .prepare("select count(*) c from issues where id = ?")
      .get(issueId) as { c: number };
    expect(raw.c).toBe(1); // still present

    const row = await db.select().from(schema.issues).where(eq(schema.issues.id, issueId)).get();
    expect(row?.deletedAt).toBeTruthy();
    expect(row?.deleteReason).toBe("Duplikat issue");

    const logs = await db.select().from(schema.auditLogs);
    expect(logs.some((l) => l.action === "issue.soft_deleted")).toBe(true);
  });

  it("manager from another division cannot delete", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await expect(softDeleteIssue(db, mgrOther, issueId, "x")).rejects.toThrow();
  });
});

describe("carry-over (§4.3 no.5)", () => {
  it("lists non-closed issues created on or before the day", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    const carried = await listCarryOverIssues(db, projectId, "2026-11-02");
    expect(carried.map((i) => i.id)).toContain(issueId);
  });

  it("excludes closed issues", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await changeIssueStatus(db, mgr, issueId, "closed");

    const carried = await listCarryOverIssues(db, projectId, "2026-11-03");
    expect(carried.map((i) => i.id)).not.toContain(issueId);
  });

  it("excludes soft-deleted issues", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    await softDeleteIssue(db, mgr, issueId, "duplikat");

    const carried = await listCarryOverIssues(db, projectId, "2026-11-03");
    expect(carried.map((i) => i.id)).not.toContain(issueId);
  });

  it("orders by severity (critical first)", async () => {
    await seedPhoto("ph-a", "u-crew");
    await seedPhoto("ph-b", "u-crew");
    await createIssue(db, crew, issueInput({ title: "Low one", severity: "low", photoIds: ["ph-a"] }));
    await createIssue(db, crew, issueInput({ title: "Critical one", severity: "critical", photoIds: ["ph-b"] }));

    const carried = await listCarryOverIssues(db, projectId, "2026-11-02");
    expect(carried[0].severity).toBe("critical");
  });
});

describe("listIssues visibility", () => {
  it("searches literal text and project identity inside the user's filtered scope", async () => {
    const { issueId } = await createIssue(db, crew, issueInput({ title: "Lampu 100%_OK khusus" }));
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
    for (const query of ["LAMPU 100%_OK", project!.name, project!.code]) {
      expect((await listIssues(db, crew, [projectId], { query })).map(row => row.id)).toEqual([issueId]);
    }
    expect(await listIssues(db, crew, [projectId], { query: "missing" })).toEqual([]);
    expect(await listIssues(db, crew, [projectId], { query: "' OR 1=1 --" })).toEqual([]);
    expect(await listIssues(db, crew, [projectId], { query: "Lampu", severity: "low" })).toEqual([]);
    expect(await listIssues(db, crew, [projectId], { query: "Lampu", projectId: "unavailable-project" })).toEqual([]);
    expect(await listIssues(db, outsider, [], { query: "Lampu" })).toEqual([]);
  });
  it("the unclosed filter includes Open/In Progress/Resolved and excludes Closed", async () => {
    for (const [index, status] of (["open", "in_progress", "resolved", "closed"] as const).entries()) {
      const photoId = `filter-photo-${index}`;
      await seedPhoto(photoId, crew.id);
      const { issueId } = await createIssue(db, crew, issueInput({ photoIds: [photoId], severity: "critical" }));
      if (status !== "open") await changeIssueStatus(db, mgr, issueId, status, "Fixture transition");
    }
    const rows = await listIssues(db, crew, [projectId], { excludeClosed: true, severity: "critical" });
    expect(rows.map(row => row.status).sort()).toEqual(["in_progress", "open", "resolved"]);
    expect(await listIssues(db, crew, [projectId], { excludeClosed: true, activeProjectsOnly: true })).toHaveLength(3);
    await db.update(schema.projects).set({ status: "completed" }).where(eq(schema.projects.id, projectId));
    expect(await listIssues(db, crew, [projectId], { excludeClosed: true, activeProjectsOnly: true })).toEqual([]);
    expect(await listIssues(db, outsider, [], { excludeClosed: true })).toEqual([]);
  });
  it("returns issues for visible projects only", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    expect((await listIssues(db, crew, [projectId])).map((i) => i.id)).toContain(issueId);
    expect(await listIssues(db, outsider, [])).toEqual([]);
  });

  it("filters by status and severity", async () => {
    await createIssue(db, crew, issueInput({ severity: "high" }));
    expect(await listIssues(db, crew, [projectId], { status: "open" })).toHaveLength(1);
    expect(await listIssues(db, crew, [projectId], { status: "closed" })).toHaveLength(0);
    expect(await listIssues(db, crew, [projectId], { severity: "low" })).toHaveLength(0);
  });

  it("includes author identity snapshot in the list", async () => {
    await createIssue(db, crew, issueInput());
    const list = await listIssues(db, crew, [projectId]);
    expect(list[0].authorName).toBe("Budi");
    expect(list[0].authorRole).toBe("user");
    expect(list[0].authorDivision).toBe("Event");
  });
});

describe("getIssueDetail", () => {
  it("returns null for a project the user cannot see", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());
    expect(await getIssueDetail(db, outsider, issueId)).toBeNull();
  });

  it("exposes canEdit/canClose per role", async () => {
    const { issueId } = await createIssue(db, crew, issueInput());

    const asCrew = await getIssueDetail(db, crew, issueId);
    expect(asCrew!.canEdit).toBe(true);
    expect(asCrew!.canClose).toBe(false);

    const asMgr = await getIssueDetail(db, mgr, issueId);
    expect(asMgr!.canClose).toBe(true);
  });
});
