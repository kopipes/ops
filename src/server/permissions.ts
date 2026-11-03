/**
 * ALL access rules live here (PRD §16.3). No route, action, or service may
 * re-implement a visibility check — they must call into this module.
 *
 * Every rule below cites the PRD section it implements.
 */
import type { UserRole } from "@/server/db/schema";

/** The minimum shape needed to evaluate permissions. */
export interface ActingUser {
  id: string;
  role: UserRole;
  /** All division ids for this user: primary + additional (user_divisions). */
  divisionIds: string[];
  isActive: boolean;
}

/** Project-scoped facts needed for a decision. Never pass raw DB rows here. */
export interface ProjectFacts {
  id: string;
  status: "draft" | "active" | "completed" | "archived";
  ownerDivisionId: string;
  /** Additional divisions (project_divisions). */
  divisionIds: string[];
  /** Active project members (project_members where is_active = 1). */
  memberIds: string[];
  /** Members with role_in_project = 'lead'. */
  leadIds: string[];
}

export type Phase = "opening" | "monitoring" | "closing";

// ---------------------------------------------------------------------------
// Role-level helpers (§2.3)
// ---------------------------------------------------------------------------

/** Admin and Corporate see every project (§2.2 rule 1). */
export const isGlobalViewer = (u: ActingUser) => u.role === "admin" || u.role === "corporate";

export const isAdmin = (u: ActingUser) => u.role === "admin";
export const isCorporate = (u: ActingUser) => u.role === "corporate";
export const isManager = (u: ActingUser) => u.role === "manager";

// ---------------------------------------------------------------------------
// Visibility (§2.2)
// ---------------------------------------------------------------------------

/** Does any of the user's divisions match the project's divisions (owner or additional)? */
export function sharesDivisionWithProject(u: ActingUser, p: ProjectFacts): boolean {
  if (u.divisionIds.includes(p.ownerDivisionId)) return true;
  return p.divisionIds.some((d) => u.divisionIds.includes(d));
}

export const isMember = (u: ActingUser, p: ProjectFacts) => p.memberIds.includes(u.id);
export const isLead = (u: ActingUser, p: ProjectFacts) => p.leadIds.includes(u.id);

/**
 * §2.2: a user may SEE a project if admin/corporate, or a member,
 * or one of their divisions belongs to the project's divisions.
 */
export function canViewProject(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isGlobalViewer(u)) return true;
  return isMember(u, p) || sharesDivisionWithProject(u, p);
}

// ---------------------------------------------------------------------------
// Management (§2.2, §2.3)
// ---------------------------------------------------------------------------

/** §2.2: admin, or a manager whose division is the project's OWNER division. */
export function canManageProject(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isAdmin(u)) return true;
  // Note: "owner division" only — an additional division grants visibility,
  // not management rights.
  return isManager(u) && u.divisionIds.includes(p.ownerDivisionId);
}

/** §2.3: create project — admin, or manager (scoped to their division at creation time). */
export const canCreateProject = (u: ActingUser) => u.isActive && (isAdmin(u) || isManager(u));

/** §2.3: assign members — same scope as managing the project. */
export const canAssignMembers = canManageProject;

// ---------------------------------------------------------------------------
// Reporting: submit (§2.2, §4.6)
// ---------------------------------------------------------------------------

/** Manager of the project's division (any division match counts for filling reports). */
export function isManagerOfProjectDivision(u: ActingUser, p: ProjectFacts): boolean {
  return isManager(u) && sharesDivisionWithProject(u, p);
}

/**
 * §2.2: monitoring & issues may be filed by an active member, a manager of the
 * project's division, or an admin.
 */
export function canSubmitMonitoring(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isAdmin(u)) return true;
  if (isManagerOfProjectDivision(u, p)) return true;
  return isMember(u, p);
}

/**
 * §4.6: opening & closing may be filed by the day's assigned officer, a Head Crew
 * (`lead`), a manager of the project's division, or an admin.
 * `assignedUserId` is `project_days.assigned_user_id`; NULL means all leads qualify.
 */
export function canSubmitOpeningClosing(
  u: ActingUser,
  p: ProjectFacts,
  assignedUserId: string | null,
): boolean {
  if (!u.isActive) return false;
  if (isAdmin(u)) return true;
  if (isManagerOfProjectDivision(u, p)) return true;
  if (assignedUserId && u.id === assignedUserId) return true;
  return isLead(u, p);
}

/** Phase-dispatching helper so callers do not branch on phase themselves. */
export function canSubmitPhase(
  u: ActingUser,
  p: ProjectFacts,
  phase: Phase,
  assignedUserId: string | null,
): boolean {
  if (phase === "monitoring") return canSubmitMonitoring(u, p);
  return canSubmitOpeningClosing(u, p, assignedUserId);
}

// ---------------------------------------------------------------------------
// Issues (§2.3)
// ---------------------------------------------------------------------------

export const canCreateIssue = canSubmitMonitoring;

export function canUpdateIssueStatus(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isAdmin(u) || isManagerOfProjectDivision(u, p)) return true;
  return isMember(u, p);
}

/**
 * §2.3 [ASUMSI]: crew may only move an issue to "Resolved";
 * only admin/manager may set "Closed".
 */
export function canCloseIssue(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  return isAdmin(u) || isManagerOfProjectDivision(u, p);
}

/** Maps a requested target status onto what this user is allowed to set. */
export function canSetIssueStatus(
  u: ActingUser,
  p: ProjectFacts,
  target: "open" | "in_progress" | "resolved" | "closed",
): boolean {
  if (!canUpdateIssueStatus(u, p)) return false;
  if (target === "closed") return canCloseIssue(u, p);
  return true;
}

// ---------------------------------------------------------------------------
// Review & export (§2.3)
// ---------------------------------------------------------------------------

/** Mark day as reviewed + comment. Corporate may review but not edit (§2.3). */
export function canReviewDay(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isAdmin(u) || isCorporate(u)) return true;
  return sharesDivisionWithProject(u, p) && isManager(u);
}

/**
 * §13.1: who may un-review a day. Default per Q14: same set as reviewing.
 */
export const canUnreviewDay = canReviewDay;

export function canExportPdf(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isAdmin(u) || isCorporate(u)) return true;
  return isManager(u) && sharesDivisionWithProject(u, p);
}

/**
 * §2.3: report visibility. Crew see only their own projects;
 * managers their division; admin/corporate everything.
 */
export function canViewReport(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isGlobalViewer(u)) return true;
  if (isManager(u)) return sharesDivisionWithProject(u, p);
  return isMember(u, p);
}

// ---------------------------------------------------------------------------
// Report EDIT window (§13.1)
// ---------------------------------------------------------------------------

export interface ReportEditFacts {
  submittedBy: string;
  status: "draft" | "submitted";
  deletedAt: number | null;
  /** project_days.reviewed_at for the day the report belongs to. */
  dayReviewedAt: number | null;
  /** project_days.date as YYYY-MM-DD. */
  dayDate: string;
  /** projects.timezone — the H+1 deadline is computed in this zone, never the server's. */
  timezone: string;
}

/** A day may be edited until it is reviewed, or until H+1 12:00 in project time. */
export function isReportEditable(
  now: number,
  facts: ReportEditFacts,
  editDeadline: (dayDate: string, timezone: string) => number,
): boolean {
  if (facts.deletedAt !== null) return false;
  if (facts.dayReviewedAt !== null) return false; // review locks the whole day
  return now < editDeadline(facts.dayDate, facts.timezone);
}

/**
 * §13.1: the author may edit within the window; manager/admin may edit any time
 * (audited in both cases).
 *
 * A review locks the whole day for EVERYONE ("satu kali review menutup edit
 * untuk semua laporan"), so the lock is checked before the manager/admin
 * bypass. Reopening is done explicitly with un-review, which clears
 * `reviewed_at` and restores the normal window.
 */
export function canEditReport(
  u: ActingUser,
  p: ProjectFacts,
  facts: ReportEditFacts,
  now: number,
  editDeadline: (dayDate: string, timezone: string) => number,
): boolean {
  if (!u.isActive) return false;
  if (facts.deletedAt !== null) return false;
  if (facts.dayReviewedAt !== null) return false; // review locks the day for everyone
  if (isAdmin(u)) return true;
  if (isManagerOfProjectDivision(u, p)) return true;
  if (facts.submittedBy !== u.id) return false;
  if (facts.status === "draft") return facts.deletedAt === null;
  return isReportEditable(now, facts, editDeadline);
}

// ---------------------------------------------------------------------------
// Admin-only surfaces (§2.3)
// ---------------------------------------------------------------------------

export const canManageUsers = (u: ActingUser) => u.isActive && isAdmin(u);
export const canAccessUserManagement = (u: ActingUser) => u.isActive && (isAdmin(u) || isManager(u));

/** Managers manage crew profiles/activation in their primary division scope. */
export function canManageUserAccount(u: ActingUser, target: { role: UserRole; primaryDivisionId: string | null }): boolean {
  return canAccessUserManagement(u) && (isAdmin(u) || (
    target.role === "user" && target.primaryDivisionId !== null && u.divisionIds.includes(target.primaryDivisionId)
  ));
}
export const canManageDivisions = (u: ActingUser) => u.isActive && isAdmin(u);
export const canViewAuditLog = (u: ActingUser) => u.isActive && isAdmin(u);
export const canManageIssueCategories = (u: ActingUser) => u.isActive && isAdmin(u);

/**
 * §2.3: master checklist items are division-scoped for managers.
 * `itemDivisionId` NULL means the item is global — only admin may change those.
 */
export function canManageChecklistItem(
  u: ActingUser,
  itemDivisionId: string | null,
): boolean {
  if (!u.isActive) return false;
  if (isAdmin(u)) return true;
  if (!isManager(u)) return false;
  if (itemDivisionId === null) return false;
  return u.divisionIds.includes(itemDivisionId);
}
