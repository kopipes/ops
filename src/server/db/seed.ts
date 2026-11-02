/**
 * Seed data (PRD §16.4).
 *
 * Creates: 3 divisions, one user per role plus a multi-division user,
 * 25 checklist items, 2 templates.
 *
 * Idempotent: safe to re-run — every write is an upsert on a fixed id.
 * Demo credentials are printed at the end; do NOT run this against production.
 */
import { getDb } from "./index";
import {
  checklistCategories,
  checklistItems,
  issueCategories,
  checklistTemplateItems,
  checklistTemplates,
  divisions,
  userDivisions,
  users,
} from "./schema";
import { runMigrations } from "./migrate";
import { hashPassword } from "@/server/auth/password";

export const DEMO_PASSWORD = "OpsDemo2026!";

const DIVISIONS = [
  { id: "div-evt", code: "EVT", name: "Event Operations" },
  { id: "div-ops", code: "OPS", name: "Site & Logistics" },
  { id: "div-cre", code: "CRE", name: "Creative & Production" },
];

interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "corporate" | "manager" | "user";
  primaryDivisionId: string;
  extraDivisions?: string[];
}

const USERS: DemoUser[] = [
  {
    id: "usr-admin",
    name: "Admin IT",
    email: "admin@ops.test",
    role: "admin",
    primaryDivisionId: "div-evt",
  },
  {
    id: "usr-corp",
    name: "Direktur Pusat",
    email: "corporate@ops.test",
    role: "corporate",
    primaryDivisionId: "div-cre",
  },
  {
    id: "usr-mgr",
    name: "Manager Event",
    email: "manager@ops.test",
    role: "manager",
    primaryDivisionId: "div-evt",
  },
  {
    id: "usr-crew",
    name: "Crew Lapangan",
    email: "crew@ops.test",
    role: "user",
    primaryDivisionId: "div-evt",
  },
  {
    // Exercises the multi-division visibility path (§2.1, §11.7 regression).
    id: "usr-multi",
    name: "Crew Lintas Divisi",
    email: "multi@ops.test",
    role: "user",
    primaryDivisionId: "div-evt",
    extraDivisions: ["div-ops", "div-cre"],
  },
];

const CATEGORIES = [
  { id: "cat-venue", name: "Venue & Area", sortOrder: 1 },
  { id: "cat-safety", name: "Keselamatan", sortOrder: 2 },
  { id: "cat-audio", name: "Audio & Visual", sortOrder: 3 },
  { id: "cat-crew", name: "Crew & Operasional", sortOrder: 4 },
];

interface SeedItem {
  label: string;
  phase: "opening" | "monitoring" | "closing";
  categoryId: string;
  requiresPhoto?: boolean;
  isRequired?: boolean;
  description?: string;
}

/** Exactly 25 items spread across the three phases (§16.4). */
const ITEMS: SeedItem[] = [
  // --- Opening (10) ---
  { label: "Area venue bersih dan siap dipakai", phase: "opening", categoryId: "cat-venue", requiresPhoto: true },
  { label: "Pintu masuk & signage terpasang benar", phase: "opening", categoryId: "cat-venue", requiresPhoto: true },
  { label: "Alat pemadam api tersedia dan tidak kedaluwarsa", phase: "opening", categoryId: "cat-safety", requiresPhoto: true },
  { label: "Jalur evakuasi bebas hambatan", phase: "opening", categoryId: "cat-safety" },
  { label: "Sound system menyala dan tes mikrofon", phase: "opening", categoryId: "cat-audio" },
  { label: "Lampu panggung & lighting berfungsi", phase: "opening", categoryId: "cat-audio", requiresPhoto: true },
  { label: "Crew hadir sesuai jadwal shift", phase: "opening", categoryId: "cat-crew" },
  { label: "Seragam & ID card crew lengkap", phase: "opening", categoryId: "cat-crew" },
  { label: "Listrik utama & genset siaga", phase: "opening", categoryId: "cat-venue" },
  { label: "Toilet & area publik bersih", phase: "opening", categoryId: "cat-venue" },

  // --- Monitoring (8) ---
  { label: "Kepadatan pengunjung masih terkendali", phase: "monitoring", categoryId: "cat-venue", requiresPhoto: true },
  { label: "Tidak ada kerusakan fasilitas baru", phase: "monitoring", categoryId: "cat-venue", requiresPhoto: true },
  { label: "Kebersihan area terjaga", phase: "monitoring", categoryId: "cat-venue" },
  { label: "Tidak ada insiden keselamatan", phase: "monitoring", categoryId: "cat-safety" },
  { label: "Audio berjalan tanpa gangguan", phase: "monitoring", categoryId: "cat-audio" },
  { label: "Crew di posisi sesuai penugasan", phase: "monitoring", categoryId: "cat-crew" },
  { label: "Antrean pengunjung terkelola", phase: "monitoring", categoryId: "cat-crew" },
  { label: "Cuaca / kondisi eksternal aman", phase: "monitoring", categoryId: "cat-safety", isRequired: false },

  // --- Closing (7) ---
  { label: "Seluruh pengunjung sudah keluar", phase: "closing", categoryId: "cat-venue", requiresPhoto: true },
  { label: "Peralatan audio & lighting dimatikan", phase: "closing", categoryId: "cat-audio" },
  { label: "Barang berharga dikembalikan ke storage", phase: "closing", categoryId: "cat-venue" },
  { label: "Sampah dibersihkan dari area", phase: "closing", categoryId: "cat-venue", requiresPhoto: true },
  { label: "Tidak ada barang tertinggal milik pengunjung", phase: "closing", categoryId: "cat-venue" },
  { label: "Laporan issue hari ini sudah dicatat", phase: "closing", categoryId: "cat-crew", isRequired: false },
  { label: "Area dikunci dan diserahkan ke security", phase: "closing", categoryId: "cat-safety", requiresPhoto: true },
];

/**
 * Issue categories (§4.7 names these explicitly). Without them the issue form
 * cannot be used, so they are part of the baseline seed rather than optional.
 */
const ISSUE_CATEGORIES = [
  { id: "icat-teknis", name: "Teknis", sortOrder: 1 },
  { id: "icat-kebersihan", name: "Kebersihan", sortOrder: 2 },
  { id: "icat-keamanan", name: "Keamanan", sortOrder: 3 },
  { id: "icat-vendor", name: "Vendor", sortOrder: 4 },
  { id: "icat-tamu", name: "Tamu", sortOrder: 5 },
  { id: "icat-lainnya", name: "Lainnya", sortOrder: 6 },
];

const TEMPLATES = [
  {
    id: "tpl-standard",
    name: "Standar Event Harian",
    description: "Template lengkap opening, monitoring, dan closing.",
    phaseFilter: null as null | string,
  },
  {
    id: "tpl-opening-closing",
    name: "Opening & Closing Saja",
    description: "Untuk project yang monitoring-nya tidak wajib.",
    phaseFilter: "opening-closing" as const,
  },
];

export async function seed() {
  runMigrations();
  const db = getDb();
  const now = Date.now();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // Divisions
  for (const d of DIVISIONS) {
    await db
      .insert(divisions)
      .values({ ...d, isActive: true, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: divisions.id,
        set: { code: d.code, name: d.name, updatedAt: now },
      });
  }

  // Users + division memberships
  for (const u of USERS) {
    await db
      .insert(users)
      .values({
        id: u.id,
        name: u.name,
        email: u.email,
        passwordHash,
        role: u.role,
        primaryDivisionId: u.primaryDivisionId,
        mustChangePassword: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: { name: u.name, role: u.role, passwordHash, updatedAt: now },
      });

    await db
      .insert(userDivisions)
      .values({ userId: u.id, divisionId: u.primaryDivisionId, isPrimary: true })
      .onConflictDoNothing();

    for (const extra of u.extraDivisions ?? []) {
      await db
        .insert(userDivisions)
        .values({ userId: u.id, divisionId: extra, isPrimary: false })
        .onConflictDoNothing();
    }
  }

  // Checklist categories
  for (const c of CATEGORIES) {
    await db
      .insert(checklistCategories)
      .values({ ...c, isActive: true, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: checklistCategories.id, set: { name: c.name, updatedAt: now } });
  }

  // Checklist items (global — divisionId NULL)
  const itemIds = new Map<string, string>();
  for (const [i, item] of ITEMS.entries()) {
    const id = `item-${String(i + 1).padStart(2, "0")}`;
    itemIds.set(item.label, id);
    await db
      .insert(checklistItems)
      .values({
        id,
        label: item.label,
        description: item.description ?? null,
        phase: item.phase,
        categoryId: item.categoryId,
        divisionId: null,
        isRequired: item.isRequired ?? true,
        requiresPhoto: item.requiresPhoto ?? false,
        isActive: true,
        sortOrder: i,
        createdBy: "usr-admin",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: checklistItems.id,
        set: { label: item.label, sortOrder: i, updatedAt: now },
      });
  }

  // Templates
  for (const t of TEMPLATES) {
    await db
      .insert(checklistTemplates)
      .values({
        id: t.id,
        name: t.name,
        description: t.description,
        divisionId: null,
        isActive: true,
        createdBy: "usr-admin",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({ target: checklistTemplates.id, set: { name: t.name, updatedAt: now } });

    const wanted = ITEMS.filter((item) =>
      t.phaseFilter === "opening-closing" ? item.phase !== "monitoring" : true,
    );
    for (const [i, item] of wanted.entries()) {
      const itemId = itemIds.get(item.label)!;
      await db
        .insert(checklistTemplateItems)
        .values({ templateId: t.id, checklistItemId: itemId, sortOrder: i })
        .onConflictDoNothing();
    }
  }

  // Issue categories
  for (const c of ISSUE_CATEGORIES) {
    await db
      .insert(issueCategories)
      .values({ ...c, isActive: true, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({
        target: issueCategories.id,
        set: { name: c.name, sortOrder: c.sortOrder, updatedAt: now },
      });
  }

  const counts = {
    divisions: (await db.select().from(divisions)).length,
    users: (await db.select().from(users)).length,
    items: (await db.select().from(checklistItems)).length,
    templates: (await db.select().from(checklistTemplates)).length,
    issueCategories: (await db.select().from(issueCategories)).length,
  };
  return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed()
    .then((c) => {
      console.log("seed complete:", c);
      console.log(`\nDemo login (password for all users: ${DEMO_PASSWORD})`);
      for (const u of USERS) console.log(`  ${u.role.padEnd(10)} ${u.email}`);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
