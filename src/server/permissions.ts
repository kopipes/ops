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
  /** The project creator is the Owner, separate from member roles. */
  ownerUserId: string | null;
  /** Additional divisions (project_divisions). */
  divisionIds: string[];
  /** Active project members (project_members where is_active = 1). */
  memberIds: string[];
  /** Members with role_in_project = 'lead'. */
  leadIds: string[];
  /** Active members with read and export access. */
  adminProjectIds: string[];
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

export const isProjectOwner = (u: ActingUser, p: ProjectFacts) => u.id === p.ownerUserId;
const isManagerOwner = (u: ActingUser, p: ProjectFacts) => isManager(u) && isProjectOwner(u, p);

export const isMember = (u: ActingUser, p: ProjectFacts) => p.memberIds.includes(u.id);
export const isAdminProject = (u: ActingUser, p: ProjectFacts) => p.adminProjectIds.includes(u.id);
export const isReportOnlyProjectMember = (u: ActingUser, p: ProjectFacts) => !isGlobalViewer(u) && isAdminProject(u, p);
export const isOperationalMember = (u: ActingUser, p: ProjectFacts) => isMember(u, p) && !isAdminProject(u, p);
export const isLead = (u: ActingUser, p: ProjectFacts) => p.leadIds.includes(u.id);

/**
 * Admin/Corporate see all projects. Managers see their own projects and active memberships.
 */
export function canViewProject(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isGlobalViewer(u)) return true;
  return isManagerOwner(u, p) || isMember(u, p);
}

/** Workspace members can see setup and issue details in addition to reports. */
export function canViewProjectWorkspace(u: ActingUser, p: ProjectFacts): boolean {
  return canViewProject(u, p) && !isReportOnlyProjectMember(u, p);
}

// ---------------------------------------------------------------------------
// Management (§2.2, §2.3)
// ---------------------------------------------------------------------------

/** Admin and the Manager who owns this project can change its setup and members. */
export function canManageProject(u: ActingUser, p: ProjectFacts): boolean {
  return u.isActive && (isAdmin(u) || isManagerOwner(u, p));
}

/** §2.3: create project — admin, or manager (scoped to their division at creation time). */
export const canCreateProject = (u: ActingUser) => u.isActive && (isAdmin(u) || isManager(u));

/** Removing an entire project is reserved for active Admin accounts. */
export const canDeleteProject = (u: ActingUser) => u.isActive && isAdmin(u);

/** §2.3: assign members — same scope as managing the project. */
export const canAssignMembers = canManageProject;

// ---------------------------------------------------------------------------
// Reporting: submit (§2.2, §4.6)
// ---------------------------------------------------------------------------

/** Manager of the project's division (any division match counts for filling reports). */
export function isManagerOfProjectDivision(u: ActingUser, p: ProjectFacts): boolean {
  return isManagerOwner(u, p) || (isOperationalMember(u, p) && isManager(u) && sharesDivisionWithProject(u, p));
}

/**
 * §2.2: monitoring & issues may be filed by an active member, a manager of the
 * project's division, or an admin.
 */
export function canSubmitMonitoring(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isAdmin(u)) return true;
  if (isManagerOfProjectDivision(u, p)) return true;
  return isOperationalMember(u, p);
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
  if (assignedUserId && u.id === assignedUserId && isOperationalMember(u, p)) return true;
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
  return isOperationalMember(u, p);
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
  return isGlobalViewer(u) || isManagerOfProjectDivision(u, p);
}

/**
 * §13.1: who may un-review a day. Default per Q14: same set as reviewing.
 */
export const canUnreviewDay = canReviewDay;

export function canExportPdf(u: ActingUser, p: ProjectFacts): boolean {
  if (!u.isActive) return false;
  if (isAdmin(u) || isCorporate(u)) return true;
  return isAdminProject(u, p) || isManagerOfProjectDivision(u, p);
}

/**
 * §2.3: report visibility. Crew see only their own projects;
 * managers their assigned projects; Admin/Corporate everything.
 */
export const canViewReport = canViewProject;

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
  /** Project timezone for report display; editing has no time limit. */
  timezone: string;
}

/** Review and elapsed time never lock reports; deleted reports remain immutable. */
export function isReportEditable(
  now: number,
  facts: ReportEditFacts,
  editDeadline: (dayDate: string, timezone: string) => number,
): boolean {
  if (facts.deletedAt !== null) return false;
  return true;
}

/** Authors may edit their own visible reports at any time; scoped managers and
 * admins may also edit. Every change is recorded as an immutable revision. */
export function canEditReport(
  u: ActingUser,
  p: ProjectFacts,
  facts: ReportEditFacts,
  now: number,
  editDeadline: (dayDate: string, timezone: string) => number,
): boolean {
  if (!u.isActive) return false;
  if (facts.deletedAt !== null) return false;
  if (!canViewProject(u, p)) return false;
  if (isAdmin(u)) return true;
  if (isAdminProject(u, p)) return false;
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
