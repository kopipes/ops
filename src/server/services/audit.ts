/**
 * Audit log querying (§9.5 no.7, §12 /admin/audit).
 */
import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { auditLogs, users } from "@/server/db/schema";
import type * as schema from "@/server/db/schema";
import { canViewAuditLog, type ActingUser } from "@/server/permissions";
import { ForbiddenError } from "./checklist-items";

type DB = BetterSQLite3Database<typeof schema>;

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string | null;
  userName: string | null;
  ip: string | null;
  metaJson: string | null;
  createdAt: number;
}

export interface AuditFilters {
  userId?: string;
  entityType?: string;
  action?: string;
  /** Inclusive ISO dates, converted to epoch ms boundaries by the caller. */
  from?: number;
  to?: number;
  limit?: number;
}

export async function listAuditLogs(
  db: DB,
  actor: ActingUser,
  filters: AuditFilters = {},
): Promise<AuditRow[]> {
  if (!canViewAuditLog(actor)) throw new ForbiddenError();

  const conditions = [];
  if (filters.userId) conditions.push(eq(auditLogs.userId, filters.userId));
  if (filters.entityType) conditions.push(eq(auditLogs.entityType, filters.entityType));
  if (filters.action) conditions.push(eq(auditLogs.action, filters.action));
  if (filters.from !== undefined) conditions.push(gte(auditLogs.createdAt, filters.from));
  if (filters.to !== undefined) conditions.push(lte(auditLogs.createdAt, filters.to));

  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      userId: auditLogs.userId,
      ip: auditLogs.ip,
      metaJson: auditLogs.metaJson,
      createdAt: auditLogs.createdAt,
      userName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.userId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(filters.limit ?? 200, 500));

  return rows;
}

/** Distinct values for the filter dropdowns. */
export async function auditFacets(db: DB, actor: ActingUser) {
  if (!canViewAuditLog(actor)) throw new ForbiddenError();

  const entityTypes = await db
    .select({ value: auditLogs.entityType, count: sql<number>`count(*)` })
    .from(auditLogs)
    .groupBy(auditLogs.entityType)
    .orderBy(auditLogs.entityType);

  const actions = await db
    .select({ value: auditLogs.action, count: sql<number>`count(*)` })
    .from(auditLogs)
    .groupBy(auditLogs.action)
    .orderBy(auditLogs.action);

  const actors = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(
      inArray(
        users.id,
        db.select({ id: auditLogs.userId }).from(auditLogs).where(sql`${auditLogs.userId} is not null`),
      ),
    )
    .orderBy(users.name);

  return {
    entityTypes: entityTypes.map((e) => ({ value: e.value, count: Number(e.count) })),
    actions: actions.map((a) => ({ value: a.value, count: Number(a.count) })),
    actors,
  };
}
