import {and,eq,isNull} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as schema from "@/server/db/schema";
import type {ActingUser,ProjectFacts} from "@/server/permissions";
import {ForbiddenError,ValidationError} from "./checklist-items";
type DB=BetterSQLite3Database<typeof schema>;
/** Use inside a synchronous write transaction so revocation cannot race a write. */
export function currentProjectAccess(db:DB,actor:ActingUser,projectId:string):{user:ActingUser;facts:ProjectFacts} {
 const row=db.select().from(schema.users).where(eq(schema.users.id,actor.id)).get();
 if(!actor.isActive||!row?.isActive||row.pendingApproval||row.mustChangePassword)throw new ForbiddenError();
 const user:ActingUser={id:row.id,role:row.role,isActive:true,divisionIds:db.select().from(schema.userDivisions).where(eq(schema.userDivisions.userId,row.id)).all().map(m=>m.divisionId)};
 const project=db.select().from(schema.projects).where(and(eq(schema.projects.id,projectId),isNull(schema.projects.deletedAt))).get();
 if(!project)throw new ValidationError("Project tidak ditemukan");
 const members=db.select().from(schema.projectMembers).where(and(eq(schema.projectMembers.projectId,project.id),eq(schema.projectMembers.isActive,true))).all();
 const divisions=db.select().from(schema.projectDivisions).where(eq(schema.projectDivisions.projectId,project.id)).all();
 return {user,facts:{id:project.id,status:project.status,ownerDivisionId:project.ownerDivisionId,divisionIds:divisions.map(d=>d.divisionId),memberIds:members.map(m=>m.userId),leadIds:members.filter(m=>m.roleInProject==='lead').map(m=>m.userId)}};
}
