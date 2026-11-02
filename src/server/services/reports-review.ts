/**
 * Report & review aggregation (§7.1, §7.2, §7.3) and the review action (§13.1).
 *
 * Design notes:
 * - Every query here is bounded by `visibleProjectIds`, resolved once and passed
 *   in. Nothing re-implements visibility.
 * - Percentages are computed from the SNAPSHOT rows that were actually answered,
 *   not from the project's current checklist, so a historical day never changes
 *   its percentage when the checklist is edited later (§5.3 no.5).
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  auditLogs,
  dayComments,
  divisions,
  issues,
  issueCategories,
  photos,
  projectChecklistItems,
  projectDays,
  projects,
  reportCheckResults,
  reportRevisions,
  reports,
  users,
} from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import {
  canReviewDay,
  canUnreviewDay,
  canViewProject,
  type ActingUser,
} from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";
import { loadFacts } from "./projects";
import { editDeadline, toLocalDate } from "@/lib/datetime";
import { isReportEditable } from "@/server/permissions";

type DB = BetterSQLite3Database<typeof schema>;

export type Phase = "opening" | "monitoring" | "closing";

// ---------------------------------------------------------------------------
// Review (§7.2 no.7, §13.1)
// ---------------------------------------------------------------------------

export async function markDayReviewed(
  db: DB,
  user: ActingUser,
  projectDayId: string,
): Promise<void> {
  const day = await db.select().from(projectDays).where(eq(projectDays.id, projectDayId)).get();
  if (!day) throw new ValidationError("Hari project tidak ditemukan");

  const facts = await loadFacts(db, day.projectId);
  if (!canReviewDay(user, facts)) {
    throw new ForbiddenError("Kamu tidak berhak mereview hari ini");
  }
  if (day.reviewedAt) return; // idempotent

  const now = Date.now();
  await db
    .update(projectDays)
    .set({ reviewedAt: now, reviewedBy: user.id, updatedAt: now })
    .where(eq(projectDays.id, projectDayId));

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: user.id,
    action: "day.reviewed",
    entityType: "project_day",
    entityId: projectDayId,
    metaJson: JSON.stringify({ projectId: day.projectId, date: day.date }),
    ip: null,
    createdAt: now,
  });
}

/**
 * Un-review (§13.1, Q14 default: allowed, audited, reason recorded).
 * Clearing `reviewed_at` reopens the report edit window.
 */
export async function unmarkDayReviewed(
  db: DB,
  user: ActingUser,
  projectDayId: string,
  reason: string,
): Promise<void> {
  if (!reason.trim()) throw new ValidationError("Alasan wajib diisi saat membatalkan review");

  const day = await db.select().from(projectDays).where(eq(projectDays.id, projectDayId)).get();
  if (!day) throw new ValidationError("Hari project tidak ditemukan");

  const facts = await loadFacts(db, day.projectId);
  if (!canUnreviewDay(user, facts)) throw new ForbiddenError("Kamu tidak berhak membatalkan review");
  if (!day.reviewedAt) return;

  const now = Date.now();
  await db
    .update(projectDays)
    .set({ reviewedAt: null, reviewedBy: null, updatedAt: now })
    .where(eq(projectDays.id, projectDayId));

  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: user.id,
    action: "day.unreviewed",
    entityType: "project_day",
    entityId: projectDayId,
    metaJson: JSON.stringify({ projectId: day.projectId, date: day.date, reason: reason.trim() }),
    ip: null,
    createdAt: now,
  });
}

/** §7.2 no.7: reviewer comment, visible to crew. Not internal-only (that's the PDF client mode). */
export async function addDayComment(
  db: DB,
  user: ActingUser,
  projectDayId: string,
  body: string,
): Promise<void> {
  if (!body.trim()) throw new ValidationError("Komentar tidak boleh kosong");
  if (body.length > 2000) throw new ValidationError("Komentar maksimal 2000 karakter");

  const day = await db.select().from(projectDays).where(eq(projectDays.id, projectDayId)).get();
  if (!day) throw new ValidationError("Hari project tidak ditemukan");

  const facts = await loadFacts(db, day.projectId);
  if (!canReviewDay(user, facts)) {
    throw new ForbiddenError("Hanya Manager, Corporate, atau Admin yang bisa berkomentar di review");
  }

  await db.insert(dayComments).values({
    id: randomUUID(),
    projectDayId,
    userId: user.id,
    body: body.trim(),
    createdAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// §7.1 Daily summary — one row per project × date
// ---------------------------------------------------------------------------

export interface DailySummaryRow {
  projectId: string;
  projectName: string;
  projectCode: string;
  divisionName: string;
  date: string;
  projectDayId: string | null;
  opening: { at: number | null; isLate: boolean; by: string | null } | null;
  closing: { at: number | null; isLate: boolean; by: string | null } | null;
  monitoringCount: number;
  /** Percentage of answered checklist items that are OK (null = nothing answered). */
  checklistOkPct: number | null;
  answeredCount: number;
  notOkCount: number;
  /** Issues created on this day. */
  issuesNew: number;
  /** All non-closed issues for the project as of this day. */
  issuesOpen: number;
  hasCriticalOpen: boolean;
  reviewedAt: number | null;
  reviewedByName: string | null;
  photoCount: number;
  isToday: boolean;
}

export interface DailySummaryFilters {
  from: string;
  to: string;
  projectId?: string;
  divisionId?: string;
  /** "incomplete" | "critical" | "unreviewed" */
  status?: "incomplete" | "critical" | "unreviewed";
}

export async function getDailySummary(
  db: DB,
  visibleProjectIds: string[],
  filters: DailySummaryFilters,
): Promise<DailySummaryRow[]> {
  if (visibleProjectIds.length === 0) return [];
  if (filters.from > filters.to) return [];

  const projectConditions = [inArray(projects.id, visibleProjectIds), isNull(projects.deletedAt)];
  if (filters.projectId) projectConditions.push(eq(projects.id, filters.projectId));
  if (filters.divisionId) {
    projectConditions.push(
      sql`(${projects.ownerDivisionId} = ${filters.divisionId}
        OR EXISTS (SELECT 1 FROM project_divisions pd
                   WHERE pd.project_id = ${projects.id} AND pd.division_id = ${filters.divisionId}))`,
    );
  }

  const projectRows = await db
    .select({
      id: projects.id,
      name: projects.name,
      code: projects.code,
      timezone: projects.timezone,
      divisionName: divisions.name,
    })
    .from(projects)
    .leftJoin(divisions, eq(divisions.id, projects.ownerDivisionId))
    .where(and(...projectConditions));

  if (projectRows.length === 0) return [];

  const projectIds = projectRows.map((p) => p.id);

  // Days in range for those projects.
  const dayRows = await db
    .select({
      id: projectDays.id,
      projectId: projectDays.projectId,
      date: projectDays.date,
      reviewedAt: projectDays.reviewedAt,
      reviewedBy: projectDays.reviewedBy,
    })
    .from(projectDays)
    .where(
      and(
        inArray(projectDays.projectId, projectIds),
        gte(projectDays.date, filters.from),
        lte(projectDays.date, filters.to),
      ),
    )
    // Order in JS below: joining `projects` here just to sort would duplicate rows
    // for no benefit, and referencing an unjoined table is an SQL error.
    .orderBy(desc(projectDays.date));

  if (dayRows.length === 0) return [];

  const dayIds = dayRows.map((d) => d.id);

  const reportRows = await db
    .select({
      id: reports.id,
      projectDayId: reports.projectDayId,
      phase: reports.phase,
      submittedAt: reports.submittedAt,
      isLate: reports.isLate,
      submittedBy: reports.submittedBy,
    })
    .from(reports)
    .where(
      and(
        inArray(reports.projectDayId, dayIds),
        isNull(reports.deletedAt),
        eq(reports.status, "submitted"),
      ),
    );

  const resultRows = await db
    .select({
      reportId: reportCheckResults.reportId,
      result: reportCheckResults.result,
    })
    .from(reportCheckResults)
    .where(inArray(reportCheckResults.reportId, reportRows.map((r) => r.id).concat("__none__")));

  const issueRows = await db
    .select({
      projectId: issues.projectId,
      projectDayId: issues.projectDayId,
      status: issues.status,
      severity: issues.severity,
    })
    .from(issues)
    .where(and(inArray(issues.projectId, projectIds), isNull(issues.deletedAt)));

  const photoRows = await db
    .select({ projectDayId: photos.projectDayId })
    .from(photos)
    .where(and(inArray(photos.projectDayId, dayIds), isNull(photos.deletedAt)));

  // Reviewer names.
  const reviewerIds = [...new Set(dayRows.map((d) => d.reviewedBy).filter(Boolean))] as string[];
  const reviewers =
    reviewerIds.length === 0
      ? []
      : await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, reviewerIds));
  const reviewerName = new Map(reviewers.map((r) => [r.id, r.name]));

  // Submitter names for the opening/closing cells.
  const submitterIds = [...new Set(reportRows.map((r) => r.submittedBy))];
  const submitters =
    submitterIds.length === 0
      ? []
      : await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, submitterIds));
  const submitterName = new Map(submitters.map((s) => [s.id, s.name]));

  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const today = new Date().toISOString().slice(0, 10);

  const rows: DailySummaryRow[] = [];

  for (const day of dayRows) {
    const project = projectById.get(day.projectId);
    if (!project) continue;

    const dayReports = reportRows.filter((r) => r.projectDayId === day.id);
    const openingReport = dayReports.find((r) => r.phase === "opening");
    const closingReport = dayReports.find((r) => r.phase === "closing");
    const monitoringCount = dayReports.filter((r) => r.phase === "monitoring").length;

    // Checklist % is computed over the results actually recorded that day.
    const dayReportIds = new Set(dayReports.map((r) => r.id));
    const dayResults = resultRows.filter((r) => dayReportIds.has(r.reportId));
    const answeredCount = dayResults.length;
    const okCount = dayResults.filter((r) => r.result === "ok").length;
    const notOkCount = dayResults.filter((r) => r.result === "not_ok").length;

    // Issues scoped to this day (new) and still-open for the project.
    const dayIssues = issueRows.filter((i) => i.projectDayId === day.id);
    const openIssues = issueRows.filter((i) => i.status !== "closed");
    const hasCriticalOpen = openIssues.some(
      (i) => i.severity === "critical" || i.severity === "high",
    );

    const row: DailySummaryRow = {
      projectId: project.id,
      projectName: project.name,
      projectCode: project.code,
      divisionName: project.divisionName ?? "",
      date: day.date,
      projectDayId: day.id,
      opening: openingReport
        ? {
            at: openingReport.submittedAt,
            isLate: Boolean(openingReport.isLate),
            by: submitterName.get(openingReport.submittedBy) ?? null,
          }
        : null,
      closing: closingReport
        ? {
            at: closingReport.submittedAt,
            isLate: Boolean(closingReport.isLate),
            by: submitterName.get(closingReport.submittedBy) ?? null,
          }
        : null,
      monitoringCount,
      checklistOkPct: answeredCount === 0 ? null : Math.round((okCount / answeredCount) * 100),
      answeredCount,
      notOkCount,
      issuesNew: dayIssues.length,
      issuesOpen: openIssues.length,
      hasCriticalOpen,
      reviewedAt: day.reviewedAt,
      reviewedByName: day.reviewedBy ? (reviewerName.get(day.reviewedBy) ?? null) : null,
      photoCount: photoRows.filter((p) => p.projectDayId === day.id).length,
      isToday: day.date === toLocalDate(Date.now(), project.timezone) || day.date === today,
    };

    rows.push(row);
  }

  // §7.1 filters.
  let filtered = rows;
  if (filters.status === "incomplete") {
    filtered = filtered.filter((r) => !r.opening || !r.closing);
  } else if (filters.status === "critical") {
    filtered = filtered.filter((r) => r.hasCriticalOpen);
  } else if (filters.status === "unreviewed") {
    filtered = filtered.filter((r) => r.reviewedAt === null);
  }

  return filtered.sort((a, b) => (a.date === b.date ? a.projectName.localeCompare(b.projectName) : b.date.localeCompare(a.date)));
}

// ---------------------------------------------------------------------------
// §7.2 Day detail
// ---------------------------------------------------------------------------

export interface DayDetail {
  project: { id: string; name: string; code: string; venue: string; client: string | null; timezone: string };
  day: {
    id: string;
    date: string;
    dayType: string;
    handoverNote: string | null;
    reviewedAt: number | null;
    reviewedByName: string | null;
    assignedUserId: string | null;
  };
  summary: {
    checklistOkPct: number | null;
    answeredCount: number;
    notOkCount: number;
    photoCount: number;
    issuesNew: number;
    issuesOpen: number;
    issuesResolvedToday: number;
    monitoringCount: number;
  };
  handoverFromPrevious: string | null;
  opening: ReportBlock | null;
  closing: ReportBlock | null;
  monitoring: ReportBlock[];
  issues: IssueCard[];
  gallery: GalleryPhoto[];
  comments: { id: string; body: string; authorName: string; authorRole: string; createdAt: number }[];
  canReview: boolean;
  canUnreview: boolean;
}

export interface ReportBlock {
  reportId: string;
  phase: Phase;
  submittedByName: string | null;
  submittedAt: number | null;
  isLate: boolean;
  notes: string | null;
  /** "Laporan Awal Hari" / "Laporan Akhir Hari" narrative. */
  phaseNote: string | null;
  latitude: string | null;
  longitude: string | null;
  locationAccuracyM: number | null;
  /** §9.5 no.4: rendered as "Diedit oleh X, jam Y". */
  editLabel: { editedByName: string | null; editedAt: number } | null;
  /** NOT_OK first, then NA, then OK (§7.2 no.2). */
  results: {
    id: string;
    label: string;
    categoryName: string;
    result: "ok" | "not_ok" | "na";
    note: string | null;
  }[];
  photos: GalleryPhoto[];
}

export interface IssueCard {
  id: string;
  code: string;
  title: string;
  severity: string;
  status: string;
  nextStep: string;
  picName: string | null;
  picExternal: string | null;
  authorName: string;
  authorRole: string;
  authorDivision: string | null;
  createdAt: number;
  categoryName: string | null;
  photoIds: string[];
}

export interface GalleryPhoto {
  id: string;
  phase: Phase | null;
  uploadedByName: string | null;
  takenAt: number | null;
  createdAt: number;
}

const RESULT_RANK: Record<string, number> = { not_ok: 0, na: 1, ok: 2 };

export async function getDayDetail(
  db: DB,
  user: ActingUser,
  projectId: string,
  date: string,
): Promise<DayDetail | null> {
  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return null;

  const facts = await loadFacts(db, projectId);
  if (!canViewProject(user, facts)) return null;

  const day = await db
    .select()
    .from(projectDays)
    .where(and(eq(projectDays.projectId, projectId), eq(projectDays.date, date)))
    .get();
  if (!day) return null;

  const dayReports = await db
    .select()
    .from(reports)
    .where(
      and(
        eq(reports.projectDayId, day.id),
        isNull(reports.deletedAt),
        eq(reports.status, "submitted"),
      ),
    )
    .orderBy(asc(reports.submittedAt));

  const reportIds = dayReports.map((r) => r.id);
  const results =
    reportIds.length === 0
      ? []
      : await db
          .select({
            id: reportCheckResults.id,
            reportId: reportCheckResults.reportId,
            result: reportCheckResults.result,
            note: reportCheckResults.note,
            label: projectChecklistItems.label,
            categoryName: projectChecklistItems.categoryName,
            sortOrder: projectChecklistItems.sortOrder,
          })
          .from(reportCheckResults)
          .innerJoin(
            projectChecklistItems,
            eq(projectChecklistItems.id, reportCheckResults.projectChecklistItemId),
          )
          .where(inArray(reportCheckResults.reportId, reportIds));

  const submitterIds = [...new Set(dayReports.map((r) => r.submittedBy))];
  const submitterRows =
    submitterIds.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, submitterIds));
  const submitterName = new Map(submitterRows.map((s) => [s.id, s.name]));

  // Photos for the day, with phase derived from the owning report.
  const dayPhotos = await db
    .select({
      id: photos.id,
      ownerType: photos.ownerType,
      ownerId: photos.ownerId,
      uploadedBy: photos.uploadedBy,
      takenAt: photos.takenAt,
      createdAt: photos.createdAt,
    })
    .from(photos)
    .where(and(eq(photos.projectDayId, day.id), isNull(photos.deletedAt)));

  const resultPhase = new Map<string, Phase>();
  for (const r of dayReports) resultPhase.set(r.id, r.phase as Phase);
  const resultToReport = new Map(results.map((r) => [r.id, r.reportId]));

  const uploaderIds = [...new Set(dayPhotos.map((p) => p.uploadedBy).filter(Boolean))] as string[];
  const uploaderRows =
    uploaderIds.length === 0
      ? []
      : await db
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, uploaderIds));
  const uploaderName = new Map(uploaderRows.map((u) => [u.id, u.name]));

  const gallery: GalleryPhoto[] = dayPhotos.map((p) => {
    let phase: Phase | null = null;
    if (p.ownerType === "report") phase = resultPhase.get(p.ownerId) ?? null;
    else if (p.ownerType === "check_result") {
      const reportId = resultToReport.get(p.ownerId);
      phase = reportId ? (resultPhase.get(reportId) ?? null) : null;
    }
    return {
      id: p.id,
      phase,
      uploadedByName: p.uploadedBy ? (uploaderName.get(p.uploadedBy) ?? null) : null,
      takenAt: p.takenAt,
      createdAt: p.createdAt,
    };
  });

  /**
   * §9.5 no.4: one lookup for every report on this day, so each block can render
   * "Diedit oleh X" without an N+1 query.
   */
  const editLabels = new Map<string, { editedByName: string | null; editedAt: number }>();
  if (reportIds.length > 0) {
    const revisions = await db
      .select({
        reportId: reportRevisions.reportId,
        editedBy: reportRevisions.editedBy,
        createdAt: reportRevisions.createdAt,
      })
      .from(reportRevisions)
      .where(inArray(reportRevisions.reportId, reportIds))
      .orderBy(asc(reportRevisions.createdAt));

    const editorIds = [...new Set(revisions.map((r) => r.editedBy).filter(Boolean))] as string[];
    const editors =
      editorIds.length === 0
        ? []
        : await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, editorIds));
    const editorName = new Map(editors.map((e) => [e.id, e.name]));

    // Last revision per report wins.
    for (const rev of revisions) {
      editLabels.set(rev.reportId, {
        editedByName: rev.editedBy ? (editorName.get(rev.editedBy) ?? null) : null,
        editedAt: rev.createdAt,
      });
    }
  }

  const buildBlock = (phase: Phase): ReportBlock | null => {
    const report = dayReports.find((r) => r.phase === phase);
    if (!report) return null;
    const blockResults = results
      .filter((r) => r.reportId === report.id)
      .sort(
        (a, b) =>
          (RESULT_RANK[a.result] ?? 9) - (RESULT_RANK[b.result] ?? 9) ||
          a.sortOrder - b.sortOrder,
      );

    return {
      reportId: report.id,
      phase,
      submittedByName: submitterName.get(report.submittedBy) ?? null,
      submittedAt: report.submittedAt,
      isLate: Boolean(report.isLate),
      notes: report.notes,
      phaseNote: report.phaseNote,
      latitude: report.latitude,
      longitude: report.longitude,
      locationAccuracyM: report.locationAccuracyM,
      editLabel: editLabels.get(report.id) ?? null,
      results: blockResults.map((r) => ({
        id: r.id,
        label: r.label,
        categoryName: r.categoryName,
        result: r.result as "ok" | "not_ok" | "na",
        note: r.note,
      })),
      photos: gallery.filter((p) => p.phase === phase),
    };
  };

  // Issues for the day (§7.2 no.5) — those created that day plus still-open ones.
  const issueRows = await db
    .select({
      id: issues.id,
      code: issues.code,
      title: issues.title,
      severity: issues.severity,
      status: issues.status,
      nextStep: issues.nextStep,
      picExternal: issues.picExternal,
      picUserId: issues.picUserId,
      authorName: issues.authorName,
      authorRole: issues.authorRole,
      authorDivision: issues.authorDivision,
      createdAt: issues.createdAt,
      categoryName: issueCategories.name,
    })
    .from(issues)
    .leftJoin(issueCategories, eq(issueCategories.id, issues.categoryId))
    .where(and(eq(issues.projectId, projectId), isNull(issues.deletedAt)))
    .orderBy(asc(issues.createdAt));

  const photoRowsForIssues =
    issueRows.length === 0
      ? []
      : await db
          .select({ id: photos.id, ownerId: photos.ownerId })
          .from(photos)
          .where(
            and(
              eq(photos.ownerType, "issue"),
              inArray(photos.ownerId, issueRows.map((i) => i.id)),
              isNull(photos.deletedAt),
            ),
          );

  const picIds = issueRows.map((i) => i.picUserId).filter(Boolean) as string[];
  const picRows =
    picIds.length === 0
      ? []
      : await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, picIds));
  const picName = new Map(picRows.map((p) => [p.id, p.name]));

  const issueCards: IssueCard[] = issueRows
    .filter((i) => i.createdAt <= day.createdAt + 86_400_000 || i.status !== "closed")
    .map((i) => ({
      id: i.id,
      code: i.code,
      title: i.title,
      severity: i.severity,
      status: i.status,
      nextStep: i.nextStep,
      picName: i.picUserId ? (picName.get(i.picUserId) ?? null) : null,
      picExternal: i.picExternal,
      authorName: i.authorName,
      authorRole: i.authorRole,
      authorDivision: i.authorDivision,
      createdAt: i.createdAt,
      categoryName: i.categoryName,
      photoIds: photoRowsForIssues.filter((p) => p.ownerId === i.id).map((p) => p.id),
    }));

  // §7.2 no.1: handover note from the previous day.
  const previousDays = await db
    .select({ date: projectDays.date, handoverNote: projectDays.handoverNote })
    .from(projectDays)
    .where(and(eq(projectDays.projectId, projectId), sql`${projectDays.date} < ${date}`))
    .orderBy(desc(projectDays.date))
    .limit(1);

  // Reviewer name + comments.
  const reviewer = day.reviewedBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, day.reviewedBy)).get()
    : null;

  const comments = await db
    .select({
      id: dayComments.id,
      body: dayComments.body,
      createdAt: dayComments.createdAt,
      userName: users.name,
      userRole: users.role,
    })
    .from(dayComments)
    .innerJoin(users, eq(users.id, dayComments.userId))
    .where(eq(dayComments.projectDayId, day.id))
    .orderBy(asc(dayComments.createdAt));

  const answeredCount = results.length;
  const okCount = results.filter((r) => r.result === "ok").length;
  const notOkCount = results.filter((r) => r.result === "not_ok").length;

  return {
    project: {
      id: project.id,
      name: project.name,
      code: project.code,
      venue: project.venue,
      client: project.client,
      timezone: project.timezone,
    },
    day: {
      id: day.id,
      date: day.date,
      dayType: day.dayType,
      handoverNote: day.handoverNote,
      reviewedAt: day.reviewedAt,
      reviewedByName: reviewer?.name ?? null,
      assignedUserId: day.assignedUserId,
    },
    summary: {
      checklistOkPct: answeredCount === 0 ? null : Math.round((okCount / answeredCount) * 100),
      answeredCount,
      notOkCount,
      photoCount: gallery.length,
      issuesNew: issueRows.filter((i) => i.createdAt >= day.createdAt).length,
      issuesOpen: issueCards.filter((i) => i.status !== "closed").length,
      issuesResolvedToday: issueRows.filter((i) => i.status === "resolved").length,
      monitoringCount: dayReports.filter((r) => r.phase === "monitoring").length,
    },
    handoverFromPrevious: previousDays[0]?.handoverNote ?? null,
    opening: buildBlock("opening"),
    closing: buildBlock("closing"),
    monitoring: dayReports
      .filter((r) => r.phase === "monitoring")
      .map((r) => {
        const blockResults = results
          .filter((x) => x.reportId === r.id)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        return {
          reportId: r.id,
          phase: "monitoring" as Phase,
          submittedByName: submitterName.get(r.submittedBy) ?? null,
          submittedAt: r.submittedAt,
          isLate: Boolean(r.isLate),
          notes: r.notes,
          phaseNote: r.phaseNote,
          latitude: r.latitude,
          longitude: r.longitude,
          locationAccuracyM: r.locationAccuracyM,
          editLabel: editLabels.get(r.id) ?? null,
          results: blockResults.map((x) => ({
            id: x.id,
            label: x.label,
            categoryName: x.categoryName,
            result: x.result as "ok" | "not_ok" | "na",
            note: x.note,
          })),
          photos: gallery.filter((p) => p.phase === "monitoring"),
        };
      }),
    issues: issueCards,
    gallery,
    comments: comments.map((c) => ({
      id: c.id,
      body: c.body,
      authorName: c.userName,
      authorRole: c.userRole,
      createdAt: c.createdAt,
    })),
    canReview: canReviewDay(user, facts),
    canUnreview: canUnreviewDay(user, facts),
  };
}

// ---------------------------------------------------------------------------
// §7.3 Dashboard
// ---------------------------------------------------------------------------

export interface DashboardData {
  today: string;
  activeProjects: number;
  openingDone: number;
  closingDone: number;
  monitoringTotal: number;
  openIssuesBySeverity: { low: number; medium: number; high: number; critical: number };
  unreviewedDays: number;
  needsAttention: {
    kind: "opening_missing" | "opening_late" | "critical_open" | "overdue";
    projectId: string;
    projectName: string;
    detail: string;
  }[];
}

export async function getDashboard(
  db: DB,
  visibleProjectIds: string[],
): Promise<DashboardData> {
  const empty: DashboardData = {
    today: new Date().toISOString().slice(0, 10),
    activeProjects: 0,
    openingDone: 0,
    closingDone: 0,
    monitoringTotal: 0,
    openIssuesBySeverity: { low: 0, medium: 0, high: 0, critical: 0 },
    unreviewedDays: 0,
    needsAttention: [],
  };
  if (visibleProjectIds.length === 0) return empty;

  const projectRows = await db
    .select({ id: projects.id, name: projects.name, timezone: projects.timezone })
    .from(projects)
    .where(
      and(
        inArray(projects.id, visibleProjectIds),
        eq(projects.status, "active"),
        isNull(projects.deletedAt),
      ),
    );

  if (projectRows.length === 0) return { ...empty, activeProjects: 0 };

  const today = empty.today;

  /*
   * `project_days.date` is a date in the PROJECT's timezone, so "today" must be
   * resolved per project. Comparing every row against a single UTC date missed
   * the current day for any project whose zone had already rolled over
   * (e.g. WIB after 17:00 UTC).
   */
  const todayByProject = new Map(
    projectRows.map((p) => [p.id, toLocalDate(Date.now(), p.timezone)] as const),
  );

  // Today's days for those projects.
  const dayRows = await db
    .select({
      id: projectDays.id,
      projectId: projectDays.projectId,
      date: projectDays.date,
    })
    .from(projectDays)
    .where(
      and(
        inArray(
          projectDays.projectId,
          projectRows.map((p) => p.id),
        ),
        inArray(projectDays.date, [...new Set(todayByProject.values())]),
      ),
    );

  // Keep only rows whose date is "today" for their own project.
  const todayDayRows = dayRows.filter((d) => todayByProject.get(d.projectId) === d.date);

  const dayIds = todayDayRows.map((d) => d.id);
  const reportRows =
    dayIds.length === 0
      ? []
      : await db
          .select({ projectDayId: reports.projectDayId, phase: reports.phase })
          .from(reports)
          .where(
            and(
              inArray(reports.projectDayId, dayIds),
              isNull(reports.deletedAt),
              eq(reports.status, "submitted"),
            ),
          );

  const issueRows = await db
    .select({ severity: issues.severity, status: issues.status, dueAt: issues.dueAt, projectId: issues.projectId })
    .from(issues)
    .where(
      and(
        inArray(
          issues.projectId,
          projectRows.map((p) => p.id),
        ),
        isNull(issues.deletedAt),
        ne(issues.status, "closed"),
      ),
    );

  const unreviewed = await db
    .select({ count: sql<number>`count(*)` })
    .from(projectDays)
    .where(
      and(
        inArray(
          projectDays.projectId,
          projectRows.map((p) => p.id),
        ),
        isNull(projectDays.reviewedAt),
        lte(projectDays.date, today),
      ),
    );

  const bySeverity = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const i of issueRows) {
    bySeverity[i.severity as keyof typeof bySeverity] += 1;
  }

  const needsAttention: DashboardData["needsAttention"] = [];
  const now = Date.now();

  for (const p of projectRows) {
    const day = dayRows.find((d) => d.projectId === p.id);
    if (!day) continue;
    const dayReports = reportRows.filter((r) => r.projectDayId === day.id);
    if (!dayReports.some((r) => r.phase === "opening")) {
      needsAttention.push({
        kind: "opening_missing",
        projectId: p.id,
        projectName: p.name,
        detail: "Opening hari ini belum diisi",
      });
    }
    if (!dayReports.some((r) => r.phase === "closing")) {
      // Only flag closing as missing late in the day.
      const hourInZone = Number(
        new Intl.DateTimeFormat("en-GB", {
          timeZone: p.timezone,
          hour: "2-digit",
          hour12: false,
        }).format(new Date()),
      );
      if (hourInZone >= 18) {
        needsAttention.push({
          kind: "opening_missing",
          projectId: p.id,
          projectName: p.name,
          detail: "Closing hari ini belum diisi",
        });
      }
    }
  }

  for (const i of issueRows) {
    if (i.severity === "critical") {
      const p = projectRows.find((x) => x.id === i.projectId);
      needsAttention.push({
        kind: "critical_open",
        projectId: i.projectId,
        projectName: p?.name ?? "",
        detail: "Ada issue Critical yang masih terbuka",
      });
    }
    if (i.dueAt && i.dueAt < now) {
      const p = projectRows.find((x) => x.id === i.projectId);
      needsAttention.push({
        kind: "overdue",
        projectId: i.projectId,
        projectName: p?.name ?? "",
        detail: "Ada issue lewat target selesai",
      });
    }
  }

  return {
    today,
    activeProjects: projectRows.length,
    openingDone: reportRows.filter((r) => r.phase === "opening").length,
    closingDone: reportRows.filter((r) => r.phase === "closing").length,
    monitoringTotal: reportRows.filter((r) => r.phase === "monitoring").length,
    openIssuesBySeverity: bySeverity,
    unreviewedDays: Number(unreviewed[0]?.count ?? 0),
    needsAttention: needsAttention.slice(0, 20),
  };
}

// ---------------------------------------------------------------------------
// §13.1: does a report in this day remain editable?
// ---------------------------------------------------------------------------

export async function isDayEditable(db: DB, projectDayId: string): Promise<boolean> {
  const day = await db.select().from(projectDays).where(eq(projectDays.id, projectDayId)).get();
  if (!day) return false;
  const project = await db.select().from(projects).where(eq(projects.id, day.projectId)).get();
  if (!project) return false;

  return isReportEditable(
    Date.now(),
    {
      submittedBy: "",
      status: "submitted",
      deletedAt: null,
      dayReviewedAt: day.reviewedAt,
      dayDate: day.date,
      timezone: project.timezone,
    },
    editDeadline,
  );
}
