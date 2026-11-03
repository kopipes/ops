/**
 * Zod schemas shared by client forms and server actions (PRD §10: one source
 * of truth for validation). Server always re-validates — see §9.3.
 */
import { z } from "zod";

export const PHASES = ["opening", "monitoring", "closing"] as const;
export const phaseSchema = z.enum(PHASES);

export const phaseLabel: Record<(typeof PHASES)[number], string> = {
  opening: "Opening",
  monitoring: "Monitoring",
  closing: "Closing",
};

const trimmed = (min: number, max: number, msg: string) =>
  z.string().trim().min(min, msg).max(max, msg);

// ---------------------------------------------------------------------------
// Checklist category
// ---------------------------------------------------------------------------

export const categoryInputSchema = z.object({
  name: trimmed(2, 60, "Nama kategori 2–60 karakter"),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

// ---------------------------------------------------------------------------
// Master checklist item (§5.1)
// ---------------------------------------------------------------------------

export const checklistItemInputSchema = z.object({
  label: trimmed(3, 200, "Label 3–200 karakter"),
  description: z
    .string()
    .trim()
    .max(500, "Deskripsi maksimal 500 karakter")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  phase: phaseSchema,
  categoryId: z.string().min(1, "Kategori wajib dipilih"),
  /**
   * Empty string means "global" (NULL). §5.1: divisi null = global.
   * Managers may only create items for their own division (or global? no —
   * global is admin-only, see permissions.canManageChecklistItem).
   */
  divisionId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  isRequired: z.coerce.boolean().default(true),
  requiresPhoto: z.coerce.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: z.coerce.boolean().default(true),
});
export type ChecklistItemInput = z.infer<typeof checklistItemInputSchema>;

export const reorderSchema = z.object({
  ids: z.array(z.string().min(1)).min(1, "Tidak ada item untuk diurutkan"),
});

// ---------------------------------------------------------------------------
// Checklist template (§5.2)
// ---------------------------------------------------------------------------

export const templateItemSchema = z.object({
  checklistItemId: z.string().min(1),
  sortOrder: z.coerce.number().int().min(0).default(0),
  /**
   * Overrides. `null` = inherit from the master item.
   * A three-state field cannot come from a plain checkbox, so the form sends
   * "inherit" | "true" | "false".
   */
  isRequiredOverride: z
    .enum(["inherit", "true", "false"])
    .default("inherit")
    .transform((v) => (v === "inherit" ? null : v === "true")),
  requiresPhotoOverride: z
    .enum(["inherit", "true", "false"])
    .default("inherit")
    .transform((v) => (v === "inherit" ? null : v === "true")),
});
export type TemplateItemInput = z.infer<typeof templateItemSchema>;

export const templateInputSchema = z.object({
  name: trimmed(3, 100, "Nama template 3–100 karakter"),
  description: z
    .string()
    .trim()
    .max(500, "Deskripsi maksimal 500 karakter")
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
  divisionId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  items: z.array(templateItemSchema).default([]),
});
export type TemplateInput = z.infer<typeof templateInputSchema>;

export const duplicateTemplateSchema = z.object({
  name: trimmed(3, 100, "Nama template baru 3–100 karakter"),
});

/** §5.2 no.2: build a template from an existing project's checklist. */
export const templateFromProjectSchema = z.object({
  projectId: z.string().min(1, "Project wajib dipilih"),
  name: trimmed(3, 100, "Nama template 3–100 karakter"),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});
export type TemplateFromProjectInput = z.infer<typeof templateFromProjectSchema>;

// ---------------------------------------------------------------------------
// Issue category (§11.5) — admin only
// ---------------------------------------------------------------------------

export const issueCategoryInputSchema = z.object({
  name: trimmed(2, 60, "Nama kategori 2–60 karakter"),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});
export type IssueCategoryInput = z.infer<typeof issueCategoryInputSchema>;

/** Small helper so HTML forms (unchecked checkbox = absent) map correctly. */
export const checkbox = (v: FormDataEntryValue | null) => v === "on" || v === "true" || v === "1";

// ---------------------------------------------------------------------------
// Project (§6.1)
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const dayTypeSchema = z.enum(["loading_in", "event", "loading_out"]);
export type DayType = z.infer<typeof dayTypeSchema>;

export const projectInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(3, "Kode project minimal 3 karakter")
      .max(40, "Kode project maksimal 40 karakter")
      .regex(/^[A-Za-z0-9-]+$/, "Kode hanya boleh huruf, angka, dan tanda hubung"),
    name: trimmed(3, 120, "Nama project 3–120 karakter"),
    client: z
      .string()
      .trim()
      .max(120)
      .transform((v) => (v === "" ? undefined : v))
      .optional(),
    venue: trimmed(2, 120, "Venue wajib diisi"),
    address: z
      .string()
      .trim()
      .max(300)
      .transform((v) => (v === "" ? undefined : v))
      .optional(),
    description: z
      .string()
      .trim()
      .max(1000)
      .transform((v) => (v === "" ? undefined : v))
      .optional(),
    startDate: z.string().regex(DATE_RE, "Tanggal mulai tidak valid"),
    endDate: z.string().regex(DATE_RE, "Tanggal selesai tidak valid"),
    timezone: z.string().min(1, "Timezone wajib diisi"),
    ownerDivisionId: z.string().min(1, "Divisi owner wajib dipilih"),
    additionalDivisionIds: z.array(z.string().min(1)).default([]),
    openingWindowStart: z.string().regex(TIME_RE, "Format jam HH:MM"),
    openingWindowEnd: z.string().regex(TIME_RE, "Format jam HH:MM"),
    closingWindowStart: z.string().regex(TIME_RE, "Format jam HH:MM"),
    closingWindowEnd: z.string().regex(TIME_RE, "Format jam HH:MM"),
    saveAsDraft: z.boolean().default(false),
    /** Checklist source (§5.3). */
    checklistSource: z.enum(["template", "project", "empty"]).default("template"),
    templateIds: z.array(z.string().min(1)).default([]),
    sourceProjectId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
    /** Hand-picked / custom project checklist rows. */
    checklistItems: z
      .array(
        z.object({
          sourceItemId: z.string().nullable().default(null),
          phase: phaseSchema,
          categoryName: z.string().trim().min(1).max(60),
          label: trimmed(2, 200, "Label item 2–200 karakter"),
          description: z.string().trim().max(500).nullable().default(null),
          isRequired: z.coerce.boolean().default(true),
          requiresPhoto: z.coerce.boolean().default(false),
          /** §5.3 no.3: also save a custom item into the master list. */
          saveToMaster: z.coerce.boolean().default(false),
        }),
      )
      .default([]),
    members: z
      .array(
        z.object({
          userId: z.string().min(1),
          roleInProject: z.enum(["lead", "crew"]).default("crew"),
        }),
      )
      .default([]),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
    path: ["endDate"],
  })
  .refine((v) => v.openingWindowStart < v.openingWindowEnd, {
    message: "Window opening: jam mulai harus sebelum jam selesai",
    path: ["openingWindowEnd"],
  })
  .refine((v) => v.closingWindowStart < v.closingWindowEnd, {
    message: "Window closing: jam mulai harus sebelum jam selesai",
    path: ["closingWindowEnd"],
  })
  .refine((v) => !v.additionalDivisionIds.includes(v.ownerDivisionId), {
    message: "Divisi tambahan tidak boleh sama dengan divisi owner",
    path: ["additionalDivisionIds"],
  });

export type ProjectInput = z.infer<typeof projectInputSchema>;

/** §6.2 status transitions. */
export const PROJECT_STATUS_FLOW = {
  draft: ["active", "archived"],
  active: ["completed", "archived", "draft"],
  completed: ["archived", "active"],
  archived: ["active"],
} as const satisfies Record<string, readonly string[]>;

const projectStatusSchema = z.enum(["draft", "active", "completed", "archived"]);

export const setStatusSchema = z.object({
  projectId: z.string().min(1),
  status: projectStatusSchema,
  reason: z
    .string()
    .trim()
    .max(300)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});

export const setMemberRoleSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  roleInProject: z.enum(["lead", "crew"]),
});

export const assignOfficerSchema = z.object({
  projectDayId: z.string().min(1),
  userId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
});

export const dayTypeUpdateSchema = z.object({
  projectDayId: z.string().min(1),
  dayType: dayTypeSchema,
});

// ---------------------------------------------------------------------------
// Issues (§4.7)
// ---------------------------------------------------------------------------

export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const ISSUE_STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export const severitySchema = z.enum(SEVERITIES);
export const issueStatusSchema = z.enum(ISSUE_STATUSES);

export const severityLabel: Record<(typeof SEVERITIES)[number], string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const issueStatusLabel: Record<(typeof ISSUE_STATUSES)[number], string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const issueInputSchema = z
  .object({
    title: z.string().trim().min(3, "Judul 3–120 karakter").max(120, "Judul maksimal 120 karakter"),
    description: z
      .string()
      .trim()
      .max(1000, "Deskripsi maksimal 1000 karakter")
      .transform((v) => (v === "" ? undefined : v))
      .optional(),
    categoryId: z.string().min(1, "Kategori wajib dipilih"),
    severity: severitySchema.default("medium"),
    /** §4.7: "Next step / action plan" is required. */
    nextStep: z.string().trim().min(3, "Next step wajib diisi").max(1000),
    /** PIC is either a project member (user id) or free text (external vendor). */
    picUserId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
    picExternal: z
      .string()
      .trim()
      .max(120)
      .transform((v) => (v === "" ? undefined : v))
      .optional(),
    dueAt: z
      .string()
      .trim()
      .optional()
      .transform((v) => {
        if (!v) return undefined;
        const ms = Date.parse(v);
        return Number.isFinite(ms) ? ms : undefined;
      }),
    /** §4.7 [ASUMSI]: at least one photo is required. */
    photoIds: z.array(z.string().min(1)).default([]),
    projectId: z.string().min(1),
    projectDayId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
    phase: z
      .enum(["opening", "monitoring", "closing"])
      .optional()
      .nullable()
      .default(null),
    /** §4.3 no.3: set when created from a "Tidak OK" checklist item. */
    checkResultId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
    reportId: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v === "" || v === undefined ? null : v)),
  })
  .refine((v) => v.photoIds.length > 0, {
    message: "Minimal 1 foto wajib dilampirkan",
    path: ["photoIds"],
  })
  // §4.7: PIC is optional. When given it must be exactly one of the two forms —
  // "neither" is valid, "both" is ambiguous.
  .refine((v) => !(v.picUserId && v.picExternal), {
    message: "PIC harus salah satu: user project atau nama eksternal",
    path: ["picUserId"],
  });

export type IssueInput = z.infer<typeof issueInputSchema>;

/** Editing an existing issue: same fields, photos may be added but not required. */
export const issueEditSchema = issueInputSchema;

export const issueStatusChangeSchema = z.object({
  issueId: z.string().min(1),
  status: issueStatusSchema,
  note: z
    .string()
    .trim()
    .max(1000)
    .transform((v) => (v === "" ? undefined : v))
    .optional(),
});

export const issueCommentSchema = z.object({
  issueId: z.string().min(1),
  note: z.string().trim().min(2, "Komentar minimal 2 karakter").max(1000),
  photoIds: z.array(z.string().min(1)).default([]),
});
