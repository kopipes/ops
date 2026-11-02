import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import {
  createChecklistItem,
  deactivateChecklistItem,
  listChecklistItems,
  projectSnapshotCountForItem,
  reorderChecklistItems,
  updateChecklistItem,
} from "./checklist-items";
import {
  createTemplate,
  createTemplateFromProject,
  deactivateTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  updateTemplate,
} from "./templates";
import { createChecklistCategory, createIssueCategory, listChecklistCategories } from "./categories";
import type { ChecklistItemInput } from "@/lib/schemas";

const MIGRATIONS = resolve(process.cwd(), "src/server/db/migrations");

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = 1_700_000_000_000;

const admin: ActingUser = { id: "u-admin", role: "admin", divisionIds: ["d-evt"], isActive: true };
const mgr: ActingUser = { id: "u-mgr", role: "manager", divisionIds: ["d-evt"], isActive: true };
const mgrOther: ActingUser = {
  id: "u-mgr2",
  role: "manager",
  divisionIds: ["d-ops"],
  isActive: true,
};
const crew: ActingUser = { id: "u-crew", role: "user", divisionIds: ["d-evt"], isActive: true };

function itemInput(over: Partial<ChecklistItemInput> = {}): ChecklistItemInput {
  return {
    label: "Cek lampu panggung",
    phase: "opening",
    categoryId: "c1",
    divisionId: null,
    isRequired: true,
    requiresPhoto: false,
    sortOrder: 0,
    isActive: true,
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
    { id: "u-crew", name: "Crew", email: "c@x", passwordHash: "h", role: "user", primaryDivisionId: "d-evt", mustChangePassword: false, isActive: true, createdAt: now, updatedAt: now },
  ]);
  await db.insert(schema.checklistCategories).values({
    id: "c1",
    name: "AV/Sound",
    sortOrder: 1,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(() => sqlite.close());

describe("checklist item permissions (§2.3, §5.1)", () => {
  it("admin creates a global item", async () => {
    const id = await createChecklistItem(db, admin, itemInput({ divisionId: null }));
    expect(id).toBeTruthy();
  });

  it("manager cannot create a global item", async () => {
    await expect(createChecklistItem(db, mgr, itemInput({ divisionId: null }))).rejects.toThrow(
      /Hanya Admin/,
    );
  });

  it("manager can create an item for their own division", async () => {
    await expect(
      createChecklistItem(db, mgr, itemInput({ divisionId: "d-evt" })),
    ).resolves.toBeTruthy();
  });

  it("manager cannot create an item for another division", async () => {
    await expect(
      createChecklistItem(db, mgr, itemInput({ divisionId: "d-ops" })),
    ).rejects.toThrow(/divisimu/);
  });

  it("crew cannot manage items at all", async () => {
    // Any rejection is acceptable; assert the item was not created.
    await expect(createChecklistItem(db, crew, itemInput())).rejects.toThrow();
    expect(await listChecklistItems(db, admin)).toHaveLength(0);
  });

  it("manager cannot edit a global item", async () => {
    const id = await createChecklistItem(db, admin, itemInput({ divisionId: null }));
    await expect(updateChecklistItem(db, mgr, id, itemInput())).rejects.toThrow(/akses/);
  });

  it("only admin can move an item between divisions", async () => {
    const id = await createChecklistItem(db, mgr, itemInput({ divisionId: "d-evt" }));
    await expect(
      updateChecklistItem(db, mgr, id, itemInput({ divisionId: "d-evt" })),
    ).resolves.toBeUndefined();
    await expect(updateChecklistItem(db, mgr, id, itemInput({ divisionId: null }))).rejects.toThrow(
      /Admin/,
    );
  });
});

describe("checklist item listing (visibility)", () => {
  beforeEach(async () => {
    await createChecklistItem(db, admin, itemInput({ label: "Global item", divisionId: null }));
    await createChecklistItem(db, mgr, itemInput({ label: "Event item", divisionId: "d-evt" }));
    await createChecklistItem(
      db,
      admin,
      itemInput({ label: "Ops item", divisionId: "d-ops" }),
    );
  });

  it("manager sees global + own division, not others", async () => {
    const rows = await listChecklistItems(db, mgr);
    expect(rows.map((r) => r.label).sort()).toEqual(["Event item", "Global item"]);
  });

  it("admin sees every item", async () => {
    const rows = await listChecklistItems(db, admin);
    expect(rows).toHaveLength(3);
  });

  it("crew sees global + own division", async () => {
    const rows = await listChecklistItems(db, crew);
    expect(rows.map((r) => r.label).sort()).toEqual(["Event item", "Global item"]);
  });
});

describe("deactivation (§5.1: never hard delete)", () => {
  it("deactivate hides the item from the default list but keeps the row", async () => {
    const id = await createChecklistItem(db, admin, itemInput());
    await deactivateChecklistItem(db, admin, id);

    expect(await listChecklistItems(db, admin)).toHaveLength(0);
    const withInactive = await listChecklistItems(db, admin, { includeInactive: true });
    expect(withInactive.find((r) => r.id === id)?.isActive).toBe(false);

    const raw = sqlite.prepare("select count(*) c from checklist_items where id = ?").get(id) as {
      c: number;
    };
    expect(raw.c).toBe(1); // row still exists — no hard delete
  });

  it("deactivating a master item does not change an existing project snapshot (§14 AC)", async () => {
    const itemId = await createChecklistItem(db, admin, itemInput({ label: "Snapshot me" }));

    // Simulate a project that snapshotted this item (M3 creates these).
    await db.insert(schema.projects).values({
      id: "p1",
      code: "PRJ-1",
      name: "Project",
      venue: "Venue",
      startDate: "2026-11-02",
      endDate: "2026-11-03",
      ownerDivisionId: "d-evt",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.projectChecklistItems).values({
      id: "pci1",
      projectId: "p1",
      sourceItemId: itemId,
      phase: "opening",
      categoryName: "AV/Sound",
      label: "Snapshot me",
      isRequired: true,
      requiresPhoto: false,
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await deactivateChecklistItem(db, admin, itemId);

    const snap = await db.select().from(schema.projectChecklistItems);
    expect(snap).toHaveLength(1);
    expect(snap[0].label).toBe("Snapshot me");
    expect(snap[0].isActive).toBe(true);
    expect(await projectSnapshotCountForItem(db, itemId)).toBe(1);
  });
});

describe("reordering", () => {
  it("persists the given order", async () => {
    const a = await createChecklistItem(db, admin, itemInput({ label: "AAA" }));
    const b = await createChecklistItem(db, admin, itemInput({ label: "BBB" }));

    await reorderChecklistItems(db, admin, [b, a]);
    const rows = await listChecklistItems(db, admin);
    expect(rows.map((r) => r.id)).toEqual([b, a]);
  });
});

describe("templates (§5.2)", () => {
  let itemIds: string[];

  beforeEach(async () => {
    itemIds = [
      await createChecklistItem(db, admin, itemInput({ label: "Open 1", phase: "opening" })),
      await createChecklistItem(db, admin, itemInput({ label: "Open 2", phase: "opening" })),
      await createChecklistItem(db, admin, itemInput({ label: "Mon 1", phase: "monitoring" })),
      await createChecklistItem(db, admin, itemInput({ label: "Close 1", phase: "closing" })),
    ];
  });

  it("creates a template with items and counts per phase", async () => {
    const id = await createTemplate(db, admin, {
      name: "Template A",
      divisionId: null,
      items: [
        { checklistItemId: itemIds[0], sortOrder: 0, isRequiredOverride: null, requiresPhotoOverride: null },
        { checklistItemId: itemIds[2], sortOrder: 1, isRequiredOverride: null, requiresPhotoOverride: null },
      ],
    });

    const found = await getTemplate(db, admin, id);
    expect(found?.items).toHaveLength(2);
    const list = await listTemplates(db, admin);
    const summary = list.find((t) => t.id === id)!;
    expect(summary.phases.opening).toBe(1);
    expect(summary.phases.monitoring).toBe(1);
    expect(summary.itemCount).toBe(2);
  });

  it("deduplicates repeated item selections", async () => {
    const id = await createTemplate(db, admin, {
      name: "Dupes",
      divisionId: null,
      items: [
        { checklistItemId: itemIds[0], sortOrder: 0, isRequiredOverride: null, requiresPhotoOverride: null },
        { checklistItemId: itemIds[0], sortOrder: 1, isRequiredOverride: null, requiresPhotoOverride: null },
      ],
    });
    const found = await getTemplate(db, admin, id);
    expect(found?.items).toHaveLength(1);
  });

  it("applies required/photo overrides over master values", async () => {
    const id = await createTemplate(db, admin, {
      name: "Overrides",
      divisionId: null,
      items: [
        {
          checklistItemId: itemIds[0],
          sortOrder: 0,
          isRequiredOverride: false,
          requiresPhotoOverride: true,
        },
      ],
    });
    const found = await getTemplate(db, admin, id);
    expect(found?.items[0].isRequired).toBe(false);
    expect(found?.items[0].requiresPhoto).toBe(true);
  });

  it("inherits master values when no override is set", async () => {
    const id = await createTemplate(db, admin, {
      name: "Inherit",
      divisionId: null,
      items: [
        { checklistItemId: itemIds[0], sortOrder: 0, isRequiredOverride: null, requiresPhotoOverride: null },
      ],
    });
    const found = await getTemplate(db, admin, id);
    expect(found?.items[0].isRequired).toBe(true); // master default
    expect(found?.items[0].requiresPhoto).toBe(false);
  });

  it("rejects referencing an item from another division", async () => {
    const foreign = await createChecklistItem(
      db,
      admin,
      itemInput({ label: "Ops only", divisionId: "d-ops" }),
    );
    await expect(
      createTemplate(db, mgr, {
        name: "Sneaky",
        divisionId: "d-evt",
        items: [
          { checklistItemId: foreign, sortOrder: 0, isRequiredOverride: null, requiresPhotoOverride: null },
        ],
      }),
    ).rejects.toThrow(/divisi lain/);
  });

  it("manager cannot create a global template", async () => {
    await expect(
      createTemplate(db, mgr, { name: "Global by mgr", divisionId: null, items: [] }),
    ).rejects.toThrow(/Global|Admin/);
  });

  it("duplicates a template including overrides", async () => {
    const id = await createTemplate(db, admin, {
      name: "Original",
      divisionId: null,
      items: [
        { checklistItemId: itemIds[0], sortOrder: 0, isRequiredOverride: false, requiresPhotoOverride: null },
        { checklistItemId: itemIds[3], sortOrder: 1, isRequiredOverride: null, requiresPhotoOverride: true },
      ],
    });

    const copyId = await duplicateTemplate(db, admin, id, "Copy");
    const copy = await getTemplate(db, admin, copyId);
    expect(copy?.summary.name).toBe("Copy");
    expect(copy?.items).toHaveLength(2);
    expect(copy?.items[0].isRequired).toBe(false);
    expect(copy?.items[1].requiresPhoto).toBe(true);
  });

  it("preserves the template's own item order across phases (§5.3)", async () => {
    // Deliberately out of phase order: closing, opening, monitoring.
    const id = await createTemplate(db, admin, {
      name: "Ordered",
      divisionId: null,
      items: [
        { checklistItemId: itemIds[3], sortOrder: 0, isRequiredOverride: null, requiresPhotoOverride: null },
        { checklistItemId: itemIds[0], sortOrder: 1, isRequiredOverride: null, requiresPhotoOverride: null },
        { checklistItemId: itemIds[2], sortOrder: 2, isRequiredOverride: null, requiresPhotoOverride: null },
      ],
    });

    const found = await getTemplate(db, admin, id);
    expect(found?.items.map((i) => i.checklistItemId)).toEqual([itemIds[3], itemIds[0], itemIds[2]]);
  });

  it("updates replace the item set", async () => {
    const id = await createTemplate(db, admin, {
      name: "Editable",
      divisionId: null,
      items: [
        { checklistItemId: itemIds[0], sortOrder: 0, isRequiredOverride: null, requiresPhotoOverride: null },
        { checklistItemId: itemIds[1], sortOrder: 1, isRequiredOverride: null, requiresPhotoOverride: null },
      ],
    });

    await updateTemplate(db, admin, id, {
      name: "Edited",
      divisionId: null,
      items: [
        { checklistItemId: itemIds[2], sortOrder: 0, isRequiredOverride: null, requiresPhotoOverride: null },
      ],
    });

    const found = await getTemplate(db, admin, id);
    expect(found?.summary.name).toBe("Edited");
    expect(found?.items.map((i) => i.checklistItemId)).toEqual([itemIds[2]]);
  });

  it("deactivation keeps the template row", async () => {
    const id = await createTemplate(db, admin, { name: "Temp", divisionId: null, items: [] });
    await deactivateTemplate(db, admin, id);

    expect((await listTemplates(db, admin)).find((t) => t.id === id)).toBeUndefined();
    expect((await listTemplates(db, admin, { includeInactive: true })).find((t) => t.id === id)).toBeDefined();
  });

  it("crew cannot create templates", async () => {
    await expect(createTemplate(db, crew, { name: "Nope", divisionId: null, items: [] })).rejects.toThrow(
      /akses/,
    );
  });
});

describe("createTemplateFromProject (§5.2 no.2)", () => {
  beforeEach(async () => {
    await db.insert(schema.projects).values({
      id: "p1",
      code: "PRJ-1",
      name: "Pameran Otomotif",
      venue: "JCC",
      startDate: "2026-11-02",
      endDate: "2026-11-03",
      ownerDivisionId: "d-evt",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  });

  it("copies linked master items and promotes custom items", async () => {
    const masterId = await createChecklistItem(db, admin, itemInput({ label: "Master one" }));

    await db.insert(schema.projectChecklistItems).values([
      {
        id: "pci1",
        projectId: "p1",
        sourceItemId: masterId,
        phase: "opening",
        categoryName: "AV/Sound",
        label: "Master one",
        isRequired: true,
        requiresPhoto: false,
        sortOrder: 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "pci2",
        projectId: "p1",
        sourceItemId: null, // custom, project-only
        phase: "closing",
        categoryName: "AV/Sound",
        label: "Custom project item",
        isRequired: false,
        requiresPhoto: true,
        sortOrder: 1,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const res = await createTemplateFromProject(
      db,
      admin,
      { projectId: "p1", name: "Dari Project" },
      { projectDivisionId: "d-evt", projectName: "Pameran Otomotif" },
    );

    expect(res.itemCount).toBe(2);
    expect(res.promotedItems).toBe(1);

    // The custom item became a master item marked with its origin project.
    const promoted = await db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.label, "Custom project item"));
    expect(promoted).toHaveLength(1);
    expect(promoted[0].sourceProjectId).toBe("p1");
    expect(promoted[0].divisionId).toBe("d-evt");

    const tpl = await getTemplate(db, admin, res.templateId);
    expect(tpl?.items).toHaveLength(2);
  });

  it("does not re-promote an item that already exists in master", async () => {
    await db.insert(schema.projectChecklistItems).values({
      id: "pci1",
      projectId: "p1",
      sourceItemId: null,
      phase: "opening",
      categoryName: "AV/Sound",
      label: "Reusable",
      isRequired: true,
      requiresPhoto: false,
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const first = await createTemplateFromProject(
      db,
      admin,
      { projectId: "p1", name: "First" },
      { projectDivisionId: "d-evt", projectName: "P" },
    );
    expect(first.promotedItems).toBe(1);

    // Second run should reuse the promoted master item, not create another.
    const second = await createTemplateFromProject(
      db,
      admin,
      { projectId: "p1", name: "Second" },
      { projectDivisionId: "d-evt", projectName: "P" },
    );
    expect(second.promotedItems).toBe(0);

    const all = await db
      .select()
      .from(schema.checklistItems)
      .where(eq(schema.checklistItems.label, "Reusable"));
    expect(all).toHaveLength(1);
  });

  it("ignores inactive snapshot rows", async () => {
    await db.insert(schema.projectChecklistItems).values({
      id: "pci1",
      projectId: "p1",
      sourceItemId: null,
      phase: "opening",
      categoryName: "AV/Sound",
      label: "Inactive",
      isRequired: true,
      requiresPhoto: false,
      sortOrder: 0,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      createTemplateFromProject(
        db,
        admin,
        { projectId: "p1", name: "Empty" },
        { projectDivisionId: "d-evt", projectName: "P" },
      ),
    ).rejects.toThrow(/tidak punya item/);
  });

  it("rejects when the manager does not own the project's division", async () => {
    await db.insert(schema.projectChecklistItems).values({
      id: "pci1",
      projectId: "p1",
      sourceItemId: null,
      phase: "opening",
      categoryName: "AV/Sound",
      label: "X",
      isRequired: true,
      requiresPhoto: false,
      sortOrder: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await expect(
      createTemplateFromProject(
        db,
        mgrOther,
        { projectId: "p1", name: "Nope" },
        { projectDivisionId: "d-evt", projectName: "P" },
      ),
    ).rejects.toThrow();
  });
});

describe("categories", () => {
  it("only admin manages checklist categories", async () => {
    await expect(createChecklistCategory(db, mgr, { name: "Keamanan", sortOrder: 2 })).rejects.toThrow(
      /akses/,
    );
    await expect(createChecklistCategory(db, admin, { name: "Keamanan", sortOrder: 2 })).resolves.toBeTruthy();
  });

  it("rejects duplicate names case-insensitively", async () => {
    await expect(createChecklistCategory(db, admin, { name: "av/sound", sortOrder: 3 })).rejects.toThrow(
      /sudah ada/,
    );
  });

  it("only admin manages issue categories", async () => {
    await expect(createIssueCategory(db, mgr, { name: "Teknis", sortOrder: 1 })).rejects.toThrow(/akses/);
    await expect(createIssueCategory(db, admin, { name: "Teknis", sortOrder: 1 })).resolves.toBeTruthy();
  });

  it("lists active categories in sort order", async () => {
    const rows = await listChecklistCategories(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("AV/Sound");
  });
});
