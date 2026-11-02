/**
 * Project members (§6.1 no.4, §4.6).
 *
 * Membership is what grants *write* access to a project (§2.1), so these
 * mutations are gated on canManageProject / canAssignMembers.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { auditLogs, projectMembers, userDivisions, users } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { canAssignMembers, type ActingUser } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "./checklist-items";
import { loadFacts } from "./projects";

type DB = BetterSQLite3Database<typeof schema>;

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  roleInProject: "lead" | "crew";
  isActive: boolean;
  divisionIds: string[];
  /** True when the member's division does not match any project division. */
  isCrossDivision: boolean;
}

export interface CandidateRow {
  userId: string;
  name: string;
  email: string;
  role: string;
  divisionNames: string[];
  /** Candidate shares a division with the project — the default filter (§6.1 no.4). */
  inProjectDivision: boolean;
}

export async function listMembers(db: DB, projectId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({
      userId: projectMembers.userId,
      roleInProject: projectMembers.roleInProject,
      isActive: projectMembers.isActive,
      name: users.name,
      email: users.email,
    })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    // Removed members are soft-deleted (§9.5): hidden here, but their historical
    // reports keep the author because those reference the user id directly.
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.isActive, true)))
    .orderBy(asc(users.name));

  if (rows.length === 0) return [];

  const divisions = await db
    .select({ userId: userDivisions.userId, divisionId: userDivisions.divisionId })
    .from(userDivisions)
    .where(
      inArray(
        userDivisions.userId,
        rows.map((r) => r.userId),
      ),
    );

  const facts = await loadFacts(db, projectId);
  const projectDivisions = new Set([facts.ownerDivisionId, ...facts.divisionIds]);

  return rows.map((r) => {
    const divs = divisions.filter((d) => d.userId === r.userId).map((d) => d.divisionId);
    return {
      ...r,
      divisionIds: divs,
      isCrossDivision: !divs.some((d) => projectDivisions.has(d)),
    };
  });
}

/**
 * Users who may be added. §6.1 no.4: default filter is users of the project's
 * divisions, but cross-division users are selectable too.
 */
export async function listMemberCandidates(db: DB, projectId: string): Promise<CandidateRow[]> {
  const facts = await loadFacts(db, projectId);
  const projectDivisions = new Set([facts.ownerDivisionId, ...facts.divisionIds]);

  const all = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.isActive, true))
    .orderBy(asc(users.name));

  if (all.length === 0) return [];

  const divisions = await db
    .select({ userId: userDivisions.userId, divisionId: userDivisions.divisionId })
    .from(userDivisions)
    .where(
      inArray(
        userDivisions.userId,
        all.map((u) => u.id),
      ),
    );

  const existing = new Set(facts.memberIds);

  return all
    .filter((u) => !existing.has(u.id))
    .map((u) => {
      const divs = divisions.filter((d) => d.userId === u.id).map((d) => d.divisionId);
      return {
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        divisionIds: divs,
        divisionNames: divs,
        inProjectDivision: divs.some((d) => projectDivisions.has(d)),
      };
    });
}

async function assertCanAssign(db: DB, user: ActingUser, projectId: string) {
  const facts = await loadFacts(db, projectId);
  if (!canAssignMembers(user, facts)) throw new ForbiddenError();
  return facts;
}

export async function addMember(
  db: DB,
  user: ActingUser,
  projectId: string,
  targetUserId: string,
  roleInProject: "lead" | "crew",
): Promise<void> {
  await assertCanAssign(db, user, projectId);

  const target = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.id, targetUserId))
    .get();
  if (!target) throw new ValidationError("User tidak ditemukan");
  if (!target.isActive) throw new ValidationError("User nonaktif tidak bisa ditambahkan");

  const now = Date.now();
  await db
    .insert(projectMembers)
    .values({
      projectId,
      userId: targetUserId,
      roleInProject,
      isActive: true,
      addedBy: user.id,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { roleInProject, isActive: true },
    });

  await audit(db, user, "project.member_added", projectId, { userId: targetUserId, roleInProject });
}

/** Soft-removal: is_active = 0, so historical reports keep their author. */
export async function removeMember(
  db: DB,
  user: ActingUser,
  projectId: string,
  targetUserId: string,
): Promise<void> {
  await assertCanAssign(db, user, projectId);

  const row = await db
    .select({ isActive: projectMembers.isActive })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)))
    .get();
  if (!row) throw new ValidationError("Member tidak ditemukan");

  await db
    .update(projectMembers)
    .set({ isActive: false })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)));

  await audit(db, user, "project.member_removed", projectId, { userId: targetUserId });
}

/** Promoting a member to lead is how §4.6 "Head Crew" is granted. */
export async function setMemberRole(
  db: DB,
  user: ActingUser,
  projectId: string,
  targetUserId: string,
  roleInProject: "lead" | "crew",
): Promise<void> {
  await assertCanAssign(db, user, projectId);

  const row = await db
    .select({ isActive: projectMembers.isActive })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)))
    .get();
  if (!row || !row.isActive) throw new ValidationError("Member aktif tidak ditemukan");

  await db
    .update(projectMembers)
    .set({ roleInProject })
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, targetUserId)));

  await audit(db, user, "project.member_role_changed", projectId, {
    userId: targetUserId,
    roleInProject,
  });
}

/**
 * Replaces the whole member list in one shot (used by the wizard step 4).
 * Users present before but absent now are deactivated, never deleted.
 */
export async function setMembers(
  db: DB,
  user: ActingUser,
  projectId: string,
  members: { userId: string; roleInProject: "lead" | "crew" }[],
): Promise<void> {
  await assertCanAssign(db, user, projectId);

  const wanted = new Map(members.map((m) => [m.userId, m.roleInProject]));
  const existing = await db
    .select({ userId: projectMembers.userId, roleInProject: projectMembers.roleInProject, isActive: projectMembers.isActive })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));

  const now = Date.now();

  for (const [userId, role] of wanted) {
    const row = existing.find((e) => e.userId === userId);
    if (!row) {
      await db.insert(projectMembers).values({
        projectId,
        userId,
        roleInProject: role,
        isActive: true,
        addedBy: user.id,
        createdAt: now,
      });
    } else if (!row.isActive || row.roleInProject !== role) {
      await db
        .update(projectMembers)
        .set({ roleInProject: role, isActive: true })
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    }
  }

  for (const row of existing) {
    if (wanted.has(row.userId) || !row.isActive) continue;
    await db
      .update(projectMembers)
      .set({ isActive: false })
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, row.userId)));
  }

  await audit(db, user, "project.members_set", projectId, { count: wanted.size });
}

async function audit(
  db: DB,
  user: ActingUser,
  action: string,
  entityId: string,
  meta: Record<string, unknown>,
) {
  await db.insert(auditLogs).values({
    id: randomUUID(),
    userId: user.id,
    action,
    entityType: "project",
    entityId,
    metaJson: JSON.stringify(meta),
    ip: null,
    createdAt: Date.now(),
  });
}
