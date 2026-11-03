/**
 * Shared loader for the crew report pages (§4.3–§4.5).
 * Keeps the three phase pages thin and consistent.
 */
import { and, asc, eq, lt } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { projectChecklistItems, projectDays, projects, users } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import type { ActingUser } from "@/server/permissions";
import {
  canSubmitPhase,
  canViewProject,
  type ProjectFacts,
} from "@/server/permissions";
import { loadFacts } from "./projects";
import {
  getReportForDayPhase,
  isPhaseOverdue,
  type DayReportSummary,
  type Phase,
} from "./reports";
import { listCarryOverIssues } from "./issues";
import { getGlobalSettings } from "./app-settings";

type DB = BetterSQLite3Database<typeof schema>;

export interface DayPageContext {
  project: typeof projects.$inferSelect;
  day: typeof projectDays.$inferSelect;
  facts: ProjectFacts;
  canSubmit: boolean;
  canView: boolean;
  existing: DayReportSummary | null;
  items: {
    id: string;
    label: string;
    description: string | null;
    categoryName: string;
    isRequired: boolean;
    requiresPhoto: boolean;
  }[];
  overdue: boolean;
  windowEnabled: boolean;
  carryOverIssues: { id: string; code: string; title: string; severity: string }[];
  handoverFromYesterday: string | null;
  monitoringCount: number;
  /** §13.1: a reviewed day locks report editing. */
  reviewedAt: number | null;
  reviewedByName: string | null;
}

export async function loadDayPageContext(
  db: DB,
  user: ActingUser,
  opts: { projectId: string; date: string; phase: Phase },
): Promise<DayPageContext | null> {
  const project = await db.select().from(projects).where(eq(projects.id, opts.projectId)).get();
  if (!project || project.deletedAt) return null;

  const day = await db
    .select()
    .from(projectDays)
    .where(and(eq(projectDays.projectId, opts.projectId), eq(projectDays.date, opts.date)))
    .get();
  if (!day) return null;

  const facts = await loadFacts(db, opts.projectId);
  const canView = canViewProject(user, facts);
  if (!canView) return null;
  const settings = await getGlobalSettings(db);

  const canSubmit = canSubmitPhase(user, facts, opts.phase, day.assignedUserId);

  const items =
    opts.phase === "monitoring"
      ? await db
          .select({
            id: projectChecklistItems.id,
            label: projectChecklistItems.label,
            description: projectChecklistItems.description,
            categoryName: projectChecklistItems.categoryName,
            isRequired: projectChecklistItems.isRequired,
            requiresPhoto: projectChecklistItems.requiresPhoto,
          })
          .from(projectChecklistItems)
          .where(
            and(
              eq(projectChecklistItems.projectId, opts.projectId),
              eq(projectChecklistItems.phase, "monitoring"),
              eq(projectChecklistItems.isActive, true),
            ),
          )
          .orderBy(asc(projectChecklistItems.sortOrder))
      : await db
          .select({
            id: projectChecklistItems.id,
            label: projectChecklistItems.label,
            description: projectChecklistItems.description,
            categoryName: projectChecklistItems.categoryName,
            isRequired: projectChecklistItems.isRequired,
            requiresPhoto: projectChecklistItems.requiresPhoto,
          })
          .from(projectChecklistItems)
          .where(
            and(
              eq(projectChecklistItems.projectId, opts.projectId),
              eq(projectChecklistItems.phase, opts.phase),
              eq(projectChecklistItems.isActive, true),
            ),
          )
          .orderBy(asc(projectChecklistItems.sortOrder));

  const existing = await getReportForDayPhase(db, day.id, opts.phase);

  // §4.5 / §4.3 no.5: issues carried over into this day (single implementation).
  const openIssues = await listCarryOverIssues(db, opts.projectId, day.date);

  // §13.1: review state gates editing.
  const reviewer = day.reviewedBy
    ? await db.select({ name: users.name }).from(users).where(eq(users.id, day.reviewedBy)).get()
    : null;

  // Opening shows the previous day's handover note (§4.5).
  let handoverFromYesterday: string | null = null;
  if (opts.phase === "opening") {
    const prev = await db
      .select({ handoverNote: projectDays.handoverNote })
      .from(projectDays)
      .where(and(eq(projectDays.projectId, opts.projectId), lt(projectDays.date, opts.date)))
      .orderBy(asc(projectDays.date))
      .all();
    const withNote = prev.filter((p) => p.handoverNote && p.handoverNote.trim() !== "");
    handoverFromYesterday = withNote.length > 0 ? withNote[withNote.length - 1].handoverNote : null;
  }

  return {
    project,
    day,
    facts,
    canSubmit,
    canView,
    existing,
    items,
    overdue: isPhaseOverdue(opts.phase, day.date, project, Date.now(), settings),
    windowEnabled: opts.phase === "opening" ? settings.openingWindowEnabled : opts.phase === "closing" ? settings.closingWindowEnabled : false,
    carryOverIssues: openIssues,
    handoverFromYesterday,
    monitoringCount: 0,
    reviewedAt: day.reviewedAt,
    reviewedByName: reviewer?.name ?? null,
  };
}
