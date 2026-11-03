/**
 * Drizzle schema — source of truth per PRD-Ops.md §11.
 *
 * Conventions (§11):
 * - `id` is TEXT (UUIDv7/ULID) because clients may generate it offline.
 * - timestamps are INTEGER unix ms (UTC). All timestamps are set by the SERVER;
 *   device-supplied time is stored separately (see `device_time_offset_ms`).
 * - `created_at` / `updated_at` exist on every table.
 * - soft delete via `deleted_at` / `is_active`.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** unix ms timestamp, integer. */
const ts = (name: string) => integer(name, { mode: "number" });

const createdAt = ts("created_at").notNull().$defaultFn(() => Date.now());
const updatedAt = ts("updated_at").notNull().$defaultFn(() => Date.now());

// ---------------------------------------------------------------------------
// 11.1 Organisasi & User
// ---------------------------------------------------------------------------

export const divisions = sqliteTable("divisions", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt,
  updatedAt,
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "corporate", "manager", "user"] }).notNull(),
  primaryDivisionId: text("primary_division_id").references(() => divisions.id),
  /** Set when an Admin resets the password (§4.1): user must change it on next login. */
  mustChangePassword: integer("must_change_password", { mode: "boolean" })
    .notNull()
    .default(false),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  /** Self-registered accounts stay inactive until an authorized activation. */
  pendingApproval: integer("pending_approval", { mode: "boolean" }).notNull().default(false),
  createdAt,
  updatedAt,
}, (t) => ({
  // emails are compared case-insensitively by the app; store lowercase.
  emailUx: uniqueIndex("users_email_ux").on(t.email),
  roleIx: index("users_role_ix").on(t.role),
}));

/**
 * Includes the primary division so a visibility check only needs one table.
 * §11.7 note: the fan-out bug came from JOINing this; use EXISTS instead.
 */
export const userDivisions = sqliteTable("user_divisions", {
  userId: text("user_id").notNull().references(() => users.id),
  divisionId: text("division_id").notNull().references(() => divisions.id),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.divisionId] }),
  divisionIx: index("user_divisions_division_ix").on(t.divisionId),
}));

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // stores a hash of the cookie value, never the raw token
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt,
}, (t) => ({
  userIx: index("sessions_user_ix").on(t.userId),
  expiresIx: index("sessions_expires_ix").on(t.expiresAt),
}));

// ---------------------------------------------------------------------------
// 11.2 Master Checklist & Template
// ---------------------------------------------------------------------------

export const checklistCategories = sqliteTable("checklist_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt,
  updatedAt,
});

export const checklistItems = sqliteTable("checklist_items", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  phase: text("phase", { enum: ["opening", "monitoring", "closing"] }).notNull(),
  categoryId: text("category_id").notNull().references(() => checklistCategories.id),
  /** NULL = global (all divisions). */
  divisionId: text("division_id").references(() => divisions.id),
  isRequired: integer("is_required", { mode: "boolean" }).notNull().default(true),
  requiresPhoto: integer("requires_photo", { mode: "boolean" }).notNull().default(false),
  /** Set when this item was created from a project's custom item. */
  sourceProjectId: text("source_project_id"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: text("created_by").references(() => users.id),
  createdAt,
  updatedAt,
}, (t) => ({
  phaseIx: index("checklist_items_phase_ix").on(t.phase),
  divisionIx: index("checklist_items_division_ix").on(t.divisionId),
}));

export const checklistTemplates = sqliteTable("checklist_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  divisionId: text("division_id").references(() => divisions.id),
  sourceProjectId: text("source_project_id"),
  createdBy: text("created_by").references(() => users.id),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt,
  updatedAt,
});

export const checklistTemplateItems = sqliteTable("checklist_template_items", {
  templateId: text("template_id").notNull().references(() => checklistTemplates.id),
  checklistItemId: text("checklist_item_id").notNull().references(() => checklistItems.id),
  sortOrder: integer("sort_order").notNull().default(0),
  isRequiredOverride: integer("is_required_override", { mode: "boolean" }),
  requiresPhotoOverride: integer("requires_photo_override", { mode: "boolean" }),
}, (t) => ({
  pk: primaryKey({ columns: [t.templateId, t.checklistItemId] }),
}));

// ---------------------------------------------------------------------------
// 11.3 Project
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ["draft", "active", "completed", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  client: text("client"),
  venue: text("venue").notNull(),
  address: text("address"),
  description: text("description"),
  /** YYYY-MM-DD, interpreted in `timezone` (§16.7). */
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  timezone: text("timezone").notNull().default("Asia/Jakarta"),
  ownerDivisionId: text("owner_division_id").notNull().references(() => divisions.id),
  status: text("status", { enum: PROJECT_STATUSES }).notNull().default("draft"),
  openingWindowStart: text("opening_window_start").notNull().default("06:00"),
  openingWindowEnd: text("opening_window_end").notNull().default("11:00"),
  closingWindowStart: text("closing_window_start").notNull().default("17:00"),
  closingWindowEnd: text("closing_window_end").notNull().default("23:59"),
  createdBy: text("created_by").references(() => users.id),
  deletedAt: ts("deleted_at"),
  createdAt,
  updatedAt,
}, (t) => ({
  codeUx: uniqueIndex("projects_code_ux").on(t.code),
  statusIx: index("projects_status_ix").on(t.status),
  ownerDivisionIx: index("projects_owner_division_ix").on(t.ownerDivisionId),
}));

export const projectDivisions = sqliteTable("project_divisions", {
  projectId: text("project_id").notNull().references(() => projects.id),
  divisionId: text("division_id").notNull().references(() => divisions.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.divisionId] }),
  divisionIx: index("project_divisions_division_ix").on(t.divisionId),
}));

export const projectMembers = sqliteTable("project_members", {
  projectId: text("project_id").notNull().references(() => projects.id),
  userId: text("user_id").notNull().references(() => users.id),
  roleInProject: text("role_in_project", { enum: ["lead", "crew"] }).notNull().default("crew"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  addedBy: text("added_by").references(() => users.id),
  createdAt,
}, (t) => ({
  pk: primaryKey({ columns: [t.projectId, t.userId] }),
  userIx: index("project_members_user_ix").on(t.userId),
}));

/**
 * One row per event day. Generated from projects.start_date..end_date (§11.3).
 * Editing project dates must follow the rules documented in §11.3:
 * extend -> insert only; shrink -> hard delete only if the day has no data,
 * otherwise keep and flag `is_out_of_range`.
 */
export const projectDays = sqliteTable("project_days", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  date: text("date").notNull(), // YYYY-MM-DD in project timezone
  dayType: text("day_type", { enum: ["loading_in", "event", "loading_out"] })
    .notNull()
    .default("event"),
  /** Officer for opening/closing that day (§4.6). NULL -> all leads may fill. */
  assignedUserId: text("assigned_user_id").references(() => users.id),
  handoverNote: text("handover_note"),
  reviewedBy: text("reviewed_by").references(() => users.id),
  reviewedAt: ts("reviewed_at"),
  /** Set when project dates shrink and this day is kept because it has data. */
  isOutOfRange: integer("is_out_of_range", { mode: "boolean" }).notNull().default(false),
  createdAt,
  updatedAt,
}, (t) => ({
  projectDateUx: uniqueIndex("project_days_project_date_ux").on(t.projectId, t.date),
  assignedIx: index("project_days_assigned_ix").on(t.assignedUserId),
}));

/** Snapshot of the checklist at project creation — master edits never change a live project. */
export const projectChecklistItems = sqliteTable("project_checklist_items", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  sourceItemId: text("source_item_id").references(() => checklistItems.id),
  phase: text("phase", { enum: ["opening", "monitoring", "closing"] }).notNull(),
  categoryName: text("category_name").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  isRequired: integer("is_required", { mode: "boolean" }).notNull().default(true),
  requiresPhoto: integer("requires_photo", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt,
  updatedAt,
}, (t) => ({
  projectPhaseIx: index("project_checklist_items_project_phase_ix").on(t.projectId, t.phase),
}));

// ---------------------------------------------------------------------------
// 11.4 Laporan
// ---------------------------------------------------------------------------

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  projectDayId: text("project_day_id").notNull().references(() => projectDays.id),
  phase: text("phase", { enum: ["opening", "monitoring", "closing"] }).notNull(),
  submittedBy: text("submitted_by").notNull().references(() => users.id),
  /** Idempotency key from the client: double submit / retry cannot create two reports. */
  clientSubmissionId: text("client_submission_id").notNull(),
  status: text("status", { enum: ["draft", "submitted"] }).notNull().default("draft"),
  notes: text("notes"),
  /**
   * Narrative report that sits AFTER the checklist for opening and closing
   * ("Laporan Awal Hari" / "Laporan Akhir Hari"). Distinct from `notes`
   * (general notes during filling) and from `project_days.handover_note`
   * (which is about tomorrow).
   */
  phaseNote: text("phase_note"),
  /**
   * Reported time of the event (monitoring). User-editable, client clock.
   * NOT authoritative — `submitted_at` / `created_at` (server) are (§9.5).
   */
  observedAt: ts("observed_at").notNull(),
  submittedAt: ts("submitted_at"),
  /** Computed once at submit from the window in force then; never recomputed (§13.2). */
  isLate: integer("is_late", { mode: "boolean" }),
  deviceTimeOffsetMs: integer("device_time_offset_ms"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  locationAccuracyM: integer("location_accuracy_m"),
  // Soft delete (§9.5 #6) — required by the partial unique index below.
  deletedAt: ts("deleted_at"),
  deletedBy: text("deleted_by").references(() => users.id),
  deleteReason: text("delete_reason"),
  createdAt,
  updatedAt,
}, (t) => ({
  clientSubmissionUx: uniqueIndex("reports_client_submission_ux").on(t.clientSubmissionId),
  dayPhaseIx: index("reports_day_phase_ix").on(t.projectDayId, t.phase),
  submitterIx: index("reports_submitter_ix").on(t.submittedBy, t.submittedAt),
  /**
   * At most one live opening and one live closing per project day.
   * Drafts are excluded so an abandoned draft cannot block the real submission,
   * and soft-deleted rows are excluded so a deleted report can be replaced.
   */
  onePerPhaseUx: uniqueIndex("reports_one_per_phase_ux")
    .on(t.projectDayId, t.phase)
    .where(
      sql`${t.phase} IN ('opening','closing') AND ${t.deletedAt} IS NULL AND ${t.status} = 'submitted'`,
    ),
}));

export const reportCheckResults = sqliteTable("report_check_results", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull().references(() => reports.id),
  projectChecklistItemId: text("project_checklist_item_id")
    .notNull()
    .references(() => projectChecklistItems.id),
  result: text("result", { enum: ["ok", "not_ok", "na"] }).notNull(),
  note: text("note"),
  createdAt,
}, (t) => ({
  reportItemUx: uniqueIndex("report_check_results_report_item_ux").on(
    t.reportId,
    t.projectChecklistItemId,
  ),
}));

// ---------------------------------------------------------------------------
// 11.5 Issues
// ---------------------------------------------------------------------------

export const issueCategories = sqliteTable("issue_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt,
  updatedAt,
});

export const issues = sqliteTable("issues", {
  id: text("id").primaryKey(),
  /** Human-friendly code, e.g. EVT-2026-0012-I-007 (§9.5 #8). */
  code: text("code").notNull(),
  projectId: text("project_id").notNull().references(() => projects.id),
  projectDayId: text("project_day_id").references(() => projectDays.id),
  phase: text("phase", { enum: ["opening", "monitoring", "closing"] }),
  reportId: text("report_id").references(() => reports.id),
  checkResultId: text("check_result_id").references(() => reportCheckResults.id),
  title: text("title").notNull(),
  description: text("description"),
  categoryId: text("category_id").notNull().references(() => issueCategories.id),
  severity: text("severity", { enum: ["low", "medium", "high", "critical"] }).notNull(),
  status: text("status", { enum: ["open", "in_progress", "resolved", "closed"] })
    .notNull()
    .default("open"),
  nextStep: text("next_step").notNull(),
  picUserId: text("pic_user_id").references(() => users.id),
  picExternal: text("pic_external"),
  dueAt: ts("due_at"),
  // Identity snapshot (§9.5 #3): survives user rename / deactivate / division change.
  createdBy: text("created_by").references(() => users.id),
  authorName: text("author_name").notNull(),
  authorRole: text("author_role").notNull(),
  authorDivision: text("author_division"),
  resolvedBy: text("resolved_by").references(() => users.id),
  resolvedAt: ts("resolved_at"),
  closedBy: text("closed_by").references(() => users.id),
  closedAt: ts("closed_at"),
  deletedAt: ts("deleted_at"),
  deletedBy: text("deleted_by").references(() => users.id),
  deleteReason: text("delete_reason"),
  createdAt,
  updatedAt,
}, (t) => ({
  codeUx: uniqueIndex("issues_code_ux").on(t.code),
  projectStatusIx: index("issues_project_status_ix").on(t.projectId, t.status),
  statusSeverityIx: index("issues_status_severity_ix").on(t.status, t.severity),
  creatorIx: index("issues_creator_ix").on(t.createdBy),
}));

/** APPEND-ONLY: no UPDATE, no DELETE (§9.5 #4). Enforced in the repository layer. */
export const issueUpdates = sqliteTable("issue_updates", {
  id: text("id").primaryKey(),
  issueId: text("issue_id").notNull().references(() => issues.id),
  userId: text("user_id").references(() => users.id),
  authorName: text("author_name").notNull(),
  authorRole: text("author_role").notNull(),
  authorDivision: text("author_division"),
  action: text("action", {
    enum: [
      "created",
      "edited",
      "status_changed",
      "comment",
      "photo_added",
      "reassigned",
      "reopened",
    ],
  }).notNull(),
  note: text("note"),
  statusFrom: text("status_from"),
  statusTo: text("status_to"),
  /** {"severity":["medium","high"], "pic_user_id":["u1","u2"]} */
  changesJson: text("changes_json"),
  createdAt,
}, (t) => ({
  issueIx: index("issue_updates_issue_ix").on(t.issueId, t.createdAt),
}));

/** Revision history for reports edited after submit (§9.5 #5). */
export const reportRevisions = sqliteTable("report_revisions", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull().references(() => reports.id),
  editedBy: text("edited_by").references(() => users.id),
  snapshotJson: text("snapshot_json").notNull(),
  changesJson: text("changes_json"),
  createdAt,
}, (t) => ({
  reportIx: index("report_revisions_report_ix").on(t.reportId, t.createdAt),
}));

// ---------------------------------------------------------------------------
// 11.6 Foto, Review, Audit
// ---------------------------------------------------------------------------

export const PHOTO_OWNER_TYPES = ["report", "check_result", "issue", "issue_update"] as const;
export type PhotoOwnerType = (typeof PHOTO_OWNER_TYPES)[number];

/**
 * NOTE: there is intentionally NO photo count limit (§8.1). No cap column, no
 * "max photos" setting — the only per-file limit is the 15 MB upload check (§8.3).
 *
 * `owner_id` is polymorphic, so it cannot carry a foreign key. Integrity is
 * enforced in the service layer; a weekly job reconciles orphans.
 */
export const photos = sqliteTable("photos", {
  id: text("id").primaryKey(),
  ownerType: text("owner_type", { enum: PHOTO_OWNER_TYPES }).notNull(),
  ownerId: text("owner_id").notNull(),
  // Denormalised for fast gallery queries.
  projectId: text("project_id").notNull().references(() => projects.id),
  projectDayId: text("project_day_id").references(() => projectDays.id),
  path: text("path").notNull(),
  thumbPath: text("thumb_path").notNull(),
  mime: text("mime").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  /** Recorded because camera vs gallery matters for review context (§8.1). */
  source: text("source", { enum: ["camera", "gallery"] }).notNull(),
  /** §8.4 idempotency key from the offline upload queue. */
  clientUploadId: text("client_upload_id"),
  takenAt: ts("taken_at"),
  uploadedBy: text("uploaded_by").references(() => users.id),
  deletedAt: ts("deleted_at"),
  deletedBy: text("deleted_by").references(() => users.id),
  createdAt,
}, (t) => ({
  ownerIx: index("photos_owner_ix").on(t.ownerType, t.ownerId),
  clientUploadUx: uniqueIndex("photos_client_upload_ux")
    .on(t.clientUploadId)
    .where(sql`${t.clientUploadId} IS NOT NULL`),
  dayIx: index("photos_day_ix").on(t.projectDayId),
  projectIx: index("photos_project_ix").on(t.projectId, t.createdAt),
}));

export const dayComments = sqliteTable("day_comments", {
  id: text("id").primaryKey(),
  projectDayId: text("project_day_id").notNull().references(() => projectDays.id),
  userId: text("user_id").notNull().references(() => users.id),
  body: text("body").notNull(),
  createdAt,
}, (t) => ({
  dayIx: index("day_comments_day_ix").on(t.projectDayId, t.createdAt),
}));

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  metaJson: text("meta_json"),
  ip: text("ip"),
  createdAt,
}, (t) => ({
  entityIx: index("audit_logs_entity_ix").on(t.entityType, t.entityId),
  userIx: index("audit_logs_user_ix").on(t.userId, t.createdAt),
}));

/**
 * Key/value app settings. Deliberately has NO photo-limit key (§8.1).
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Division = typeof divisions.$inferSelect;
export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectDay = typeof projectDays.$inferSelect;
export type Report = typeof reports.$inferSelect;
export type Issue = typeof issues.$inferSelect;
export type Photo = typeof photos.$inferSelect;

export type UserRole = User["role"];
export type Phase = Report["phase"];
export type Severity = Issue["severity"];
export type IssueStatus = Issue["status"];

