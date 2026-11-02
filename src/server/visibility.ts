/**
 * Project visibility — the single implementation of PRD §11.7.
 *
 * Uses EXISTS subqueries rather than JOINs: the original draft joined
 * `user_divisions`, which fans out rows and can duplicate projects (and let a
 * division match leak project membership semantics). Every project-scoped
 * query must go through `visibleProjectIds()`.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import {
  projectDivisions,
  projectMembers,
  projects,
  userDivisions,
} from "./db/schema";
import type * as schema from "./db/schema";
import type { ActingUser, ProjectFacts } from "./permissions";
import { isGlobalViewer } from "./permissions";

type DB = BetterSQLite3Database<typeof schema>;

/**
 * Predicate: project row is visible to this user.
 * Mirrors §2.2 exactly — admin/corporate see all; otherwise member OR division match.
 */
export function visibleProjectPredicate(u: ActingUser): SQL | undefined {
  if (isGlobalViewer(u)) return undefined; // no filter
  return or(
    sql`EXISTS (SELECT 1 FROM ${projectMembers} pm
               WHERE pm.project_id = ${projects.id}
                 AND pm.user_id = ${u.id}
                 AND pm.is_active = 1)`,
    sql`${projects.ownerDivisionId} IN (
          SELECT ud.division_id FROM ${userDivisions} ud WHERE ud.user_id = ${u.id})`,
    sql`EXISTS (SELECT 1 FROM ${projectDivisions} pd
               JOIN ${userDivisions} ud ON ud.division_id = pd.division_id
               WHERE pd.project_id = ${projects.id} AND ud.user_id = ${u.id})`,
  );
}

/**
 * All project ids this user may see. Archived projects are hidden by default
 * (PRD §11.7 role rules); pass includeArchived to show them explicitly.
 */
export async function visibleProjectIds(
  db: DB,
  u: ActingUser,
  opts: { includeArchived?: boolean; includeDeleted?: boolean } = {},
): Promise<string[]> {
  const filters: (SQL | undefined)[] = [visibleProjectPredicate(u)];
  if (!opts.includeArchived) filters.push(sql`${projects.status} <> 'archived'`);
  if (!opts.includeDeleted) filters.push(isNull(projects.deletedAt));

  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(...filters.filter(Boolean)) as SQL);

  return rows.map((r) => r.id);
}

/** Loads the facts `permissions.ts` needs, in one round trip per table. */
export async function loadProjectFacts(
  db: DB,
  projectIds: string[],
): Promise<Map<string, ProjectFacts>> {
  const out = new Map<string, ProjectFacts>();
  if (projectIds.length === 0) return out;

  const base = await db
    .select({
      id: projects.id,
      status: projects.status,
      ownerDivisionId: projects.ownerDivisionId,
    })
    .from(projects)
    .where(inArray(projects.id, projectIds));

  const divs = await db
    .select({ projectId: projectDivisions.projectId, divisionId: projectDivisions.divisionId })
    .from(projectDivisions)
    .where(inArray(projectDivisions.projectId, projectIds));

  const members = await db
    .select({
      projectId: projectMembers.projectId,
      userId: projectMembers.userId,
      role: projectMembers.roleInProject,
    })
    .from(projectMembers)
    .where(and(inArray(projectMembers.projectId, projectIds), eq(projectMembers.isActive, true)));

  for (const p of base) {
    out.set(p.id, {
      id: p.id,
      status: p.status,
      ownerDivisionId: p.ownerDivisionId,
      divisionIds: [],
      memberIds: [],
      leadIds: [],
    });
  }
  for (const d of divs) out.get(d.projectId)?.divisionIds.push(d.divisionId);
  for (const m of members) {
    const f = out.get(m.projectId);
    if (!f) continue;
    f.memberIds.push(m.userId);
    if (m.role === "lead") f.leadIds.push(m.userId);
  }
  return out;
}
