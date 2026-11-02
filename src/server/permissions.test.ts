import { describe, expect, it } from "vitest";
import {
  canAssignMembers,
  canCloseIssue,
  canEditReport,
  canExportPdf,
  canManageChecklistItem,
  canManageProject,
  canManageUsers,
  canReviewDay,
  canSetIssueStatus,
  canSubmitMonitoring,
  canSubmitOpeningClosing,
  canViewProject,
  canViewReport,
  isReportEditable,
  type ActingUser,
  type ProjectFacts,
  type ReportEditFacts,
} from "./permissions";
import { editDeadline } from "@/lib/datetime";

const user = (over: Partial<ActingUser> = {}): ActingUser => ({
  id: "u-crew",
  role: "user",
  divisionIds: ["d-evt"],
  isActive: true,
  ...over,
});

const project = (over: Partial<ProjectFacts> = {}): ProjectFacts => ({
  id: "p1",
  status: "active",
  ownerDivisionId: "d-evt",
  divisionIds: [],
  memberIds: [],
  leadIds: [],
  ...over,
});

describe("visibility (§2.2)", () => {
  it("admin and corporate see everything", () => {
    const p = project({ ownerDivisionId: "d-other", memberIds: [] });
    expect(canViewProject(user({ role: "admin", divisionIds: [] }), p)).toBe(true);
    expect(canViewProject(user({ role: "corporate", divisionIds: [] }), p)).toBe(true);
  });

  it("owner division grants visibility", () => {
    expect(canViewProject(user(), project())).toBe(true);
  });

  it("additional project division grants visibility", () => {
    const p = project({ ownerDivisionId: "d-other", divisionIds: ["d-evt"] });
    expect(canViewProject(user(), p)).toBe(true);
  });

  it("unrelated division with no membership cannot see the project", () => {
    const p = project({ ownerDivisionId: "d-other", divisionIds: [] });
    expect(canViewProject(user({ divisionIds: ["d-evt"] }), p)).toBe(false);
  });

  it("membership grants visibility even across divisions", () => {
    const p = project({ ownerDivisionId: "d-other", memberIds: ["u-crew"] });
    expect(canViewProject(user(), p)).toBe(true);
  });

  it("inactive users see nothing", () => {
    expect(canViewProject(user({ isActive: false, role: "admin" }), project())).toBe(false);
  });
});

describe("project management (§2.2)", () => {
  it("manager manages only projects owned by their division", () => {
    const mgr = user({ role: "manager" });
    expect(canManageProject(mgr, project())).toBe(true);
    expect(canManageProject(mgr, project({ ownerDivisionId: "d-other", divisionIds: ["d-evt"] }))).toBe(
      false,
    );
  });

  it("an additional project division does NOT grant management", () => {
    const mgr = user({ role: "manager", divisionIds: ["d-evt"] });
    const p = project({ ownerDivisionId: "d-other", divisionIds: ["d-evt"] });
    expect(canViewProject(mgr, p)).toBe(true);
    expect(canManageProject(mgr, p)).toBe(false);
    expect(canAssignMembers(mgr, p)).toBe(false);
  });

  it("crew can never manage projects", () => {
    expect(canManageProject(user(), project())).toBe(false);
  });
});

describe("submitting reports (§2.2, §4.6)", () => {
  it("monitoring: active member may submit", () => {
    expect(canSubmitMonitoring(user(), project({ memberIds: ["u-crew"] }))).toBe(true);
  });

  it("monitoring: non-member of the division may not submit", () => {
    const p = project({ ownerDivisionId: "d-other", divisionIds: [] });
    expect(canSubmitMonitoring(user(), p)).toBe(false);
  });

  it("opening/closing: plain crew member may NOT submit", () => {
    const p = project({ memberIds: ["u-crew"] });
    expect(canSubmitOpeningClosing(user(), p, null)).toBe(false);
  });

  it("opening/closing: head crew (lead) may submit", () => {
    const p = project({ memberIds: ["u-crew"], leadIds: ["u-crew"] });
    expect(canSubmitOpeningClosing(user(), p, null)).toBe(true);
  });

  it("opening/closing: assigned officer may submit even if not a lead", () => {
    const p = project({ memberIds: ["u-crew"] });
    expect(canSubmitOpeningClosing(user(), p, "u-crew")).toBe(true);
  });

  it("opening/closing: a different assigned officer does not grant rights", () => {
    const p = project({ memberIds: ["u-crew", "u-other"], leadIds: [] });
    expect(canSubmitOpeningClosing(user(), p, "u-other")).toBe(false);
  });

  it("manager of the project division may submit opening/closing", () => {
    const mgr = user({ role: "manager" });
    expect(canSubmitOpeningClosing(mgr, project({ ownerDivisionId: "d-other", divisionIds: ["d-evt"] }), null)).toBe(true);
  });
});

describe("issues (§2.3)", () => {
  const member = project({ memberIds: ["u-crew"] });

  it("crew may resolve but not close", () => {
    expect(canSetIssueStatus(user(), member, "resolved")).toBe(true);
    expect(canSetIssueStatus(user(), member, "closed")).toBe(false);
    expect(canCloseIssue(user(), member)).toBe(false);
  });

  it("manager may close", () => {
    const mgr = user({ role: "manager" });
    expect(canSetIssueStatus(mgr, project(), "closed")).toBe(true);
  });

  it("non-member crew cannot change status at all", () => {
    const p = project({ ownerDivisionId: "d-other", memberIds: [] });
    expect(canSetIssueStatus(user(), p, "resolved")).toBe(false);
  });
});

describe("review & export (§2.3)", () => {
  it("corporate may review but not manage", () => {
    const corp = user({ role: "corporate", divisionIds: [] });
    expect(canReviewDay(corp, project())).toBe(true);
    expect(canManageProject(corp, project())).toBe(false);
  });

  it("crew may not review or export", () => {
    expect(canReviewDay(user(), project({ memberIds: ["u-crew"] }))).toBe(false);
    expect(canExportPdf(user(), project({ memberIds: ["u-crew"] }))).toBe(false);
  });
});

describe("admin-only surfaces (§2.3)", () => {
  it("only admin manages users", () => {
    expect(canManageUsers(user({ role: "admin" }))).toBe(true);
    expect(canManageUsers(user({ role: "manager" }))).toBe(false);
  });

  it("global checklist items are admin-only; division items allow that manager", () => {
    const mgr = user({ role: "manager" });
    expect(canManageChecklistItem(mgr, null)).toBe(false);
    expect(canManageChecklistItem(mgr, "d-evt")).toBe(true);
    expect(canManageChecklistItem(mgr, "d-other")).toBe(false);
    expect(canManageChecklistItem(user({ role: "admin" }), null)).toBe(true);
  });
});

describe("report edit window (§13.1)", () => {
  const DAY = "2026-11-02";
  const TZ = "Asia/Jakarta";
  const deadline = editDeadline(DAY, TZ); // 2026-11-03 12:00 +07

  const facts = (over: Partial<ReportEditFacts> = {}): ReportEditFacts => ({
    submittedBy: "u-crew",
    status: "submitted",
    deletedAt: null,
    dayReviewedAt: null,
    dayDate: DAY,
    timezone: TZ,
    ...over,
  });

  it("deadline is H+1 12:00 in project time", () => {
    // 2026-11-03T12:00+07:00 == 2026-11-03T05:00Z
    expect(new Date(deadline).toISOString()).toBe("2026-11-03T05:00:00.000Z");
  });

  it("author may edit before the deadline", () => {
    const before = deadline - 60_000;
    expect(isReportEditable(before, facts(), editDeadline)).toBe(true);
  });

  it("author may not edit after the deadline", () => {
    expect(isReportEditable(deadline + 1, facts(), editDeadline)).toBe(false);
  });

  it("review closes editing even before the deadline", () => {
    expect(isReportEditable(deadline - 60_000, facts({ dayReviewedAt: 1 }), editDeadline)).toBe(
      false,
    );
  });

  it("manager and admin may edit after the deadline, crew may not", () => {
    const after = deadline + 60_000;
    const p = project();
    expect(canEditReport(user({ role: "admin" }), p, facts(), after, editDeadline)).toBe(true);
    expect(canEditReport(user({ role: "manager" }), p, facts(), after, editDeadline)).toBe(true);
    expect(canEditReport(user(), p, facts(), after, editDeadline)).toBe(false);
  });

  it("another crew member cannot edit someone else's report", () => {
    const other = user({ id: "u-other", role: "user" });
    expect(canEditReport(other, project(), facts(), deadline - 60_000, editDeadline)).toBe(false);
  });

  it("a draft is editable regardless of time", () => {
    const late = deadline + 10_000_000;
    expect(canEditReport(user(), project(), facts({ status: "draft" }), late, editDeadline)).toBe(
      true,
    );
  });

  // §13.1: "satu kali review menutup edit untuk semua laporan". The manager/admin
  // bypass lifts the H+1 deadline, never the review lock.
  it("review locks the day for manager and admin too, until un-reviewed", () => {
    const before = deadline - 60_000;
    const reviewed = facts({ dayReviewedAt: 1 });
    const p = project();
    expect(canEditReport(user({ role: "admin" }), p, reviewed, before, editDeadline)).toBe(false);
    expect(canEditReport(user({ role: "manager" }), p, reviewed, before, editDeadline)).toBe(false);
    // Un-review (reviewed_at cleared) reopens the window as before.
    expect(canEditReport(user({ role: "manager" }), p, facts(), before, editDeadline)).toBe(true);
  });

  it("review also locks a draft, for everyone", () => {
    const before = deadline - 60_000;
    const reviewedDraft = facts({ status: "draft", dayReviewedAt: 1 });
    expect(canEditReport(user(), project(), reviewedDraft, before, editDeadline)).toBe(false);
  });
});

describe("report visibility (§2.3)", () => {
  it("crew see only their own projects; managers their division", () => {
    const p = project({ memberIds: ["u-crew"] });
    expect(canViewReport(user(), p)).toBe(true);
    expect(canViewReport(user({ id: "u-x" }), p)).toBe(false);
    expect(canViewReport(user({ role: "manager" }), project())).toBe(true);
  });
});
