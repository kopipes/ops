import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "@/server/db/schema";
import { canReviewDay, canViewProject, type ActingUser } from "@/server/permissions";
import { visibleProjectPredicate } from "@/server/visibility";
import { currentProjectAccess } from "./project-access";
import { ForbiddenError, ValidationError } from "./checklist-items";

type DB = BetterSQLite3Database<typeof schema>;
export const REVIEW_ACTION_LABELS = { re_check:"Re-check", re_take_photo:"Re-take photo", others:"Others" } as const;
export type ReviewAction = keyof typeof REVIEW_ACTION_LABELS;
export interface PointReview {id:string;verdict:"ok"|"not_ok";action:ReviewAction|null;note:string|null;authorName:string;createdAt:number;contentHash:string;}
export function pointContentHash(result:string,note:string|null,photoIds:string[]) {
  return createHash("sha256").update(JSON.stringify([result,note??"",[...photoIds].sort()])).digest("hex");
}

/** Re-read the account and memberships inside the same write transaction. */
function freshActor(db: DB, actor: ActingUser): ActingUser {
  const row=db.select().from(schema.users).where(eq(schema.users.id,actor.id)).get();
  if(!row?.isActive || row.pendingApproval || row.mustChangePassword)throw new ForbiddenError();
  const memberships=db.select().from(schema.userDivisions).where(eq(schema.userDivisions.userId,actor.id)).all();
  return {id:row.id,role:row.role,isActive:true,divisionIds:memberships.map(m=>m.divisionId)};
}
export function addPointReview(db:DB,actor:ActingUser,input:{id:string;checkResultId:string;verdict:string;action:string;note:string;contentHash:string}) {
  if(!/^[0-9a-f-]{36}$/i.test(input.id))throw new ValidationError("Kunci review tidak valid");
  if(!["ok","not_ok"].includes(input.verdict))throw new ValidationError("Pilih hasil review");
  const note=input.note.trim();
  if(note.length>2000)throw new ValidationError("Komentar maksimal 2000 karakter");
  if(input.verdict==="not_ok" && (!Object.hasOwn(REVIEW_ACTION_LABELS,input.action)||!note))throw new ValidationError("Pilih tindak lanjut dan isi komentar perbaikan");
  return db.transaction(tx=>{
    const context=tx.select({result:schema.reportCheckResults,report:schema.reports,project:schema.projects})
      .from(schema.reportCheckResults).innerJoin(schema.reports,eq(schema.reports.id,schema.reportCheckResults.reportId))
      .innerJoin(schema.projects,eq(schema.projects.id,schema.reports.projectId))
      .where(and(eq(schema.reportCheckResults.id,input.checkResultId),isNull(schema.reports.deletedAt),isNull(schema.projects.deletedAt),eq(schema.reports.status,"submitted"))).get();
    if(!context)throw new ValidationError("Poin laporan tidak ditemukan");
    const { user, facts } = currentProjectAccess(tx, actor, context.project.id);
    if(!canViewProject(user,facts)||!canReviewDay(user,facts))throw new ForbiddenError("Kamu tidak berhak mereview poin ini");
    const action=input.verdict==="not_ok"?input.action as ReviewAction:null;
    const prior=tx.select().from(schema.checkResultReviews).where(eq(schema.checkResultReviews.id,input.id)).get();
    if(prior) {
      if(prior.userId!==user.id||prior.checkResultId!==input.checkResultId||prior.verdict!==input.verdict||prior.action!==action||prior.note!==(note||null)||prior.contentHash!==input.contentHash)throw new ValidationError("Review sudah digunakan. Muat ulang halaman.");
      return {projectDayId:context.report.projectDayId,id:prior.id};
    }
    const attached=tx.select({id:schema.photos.id}).from(schema.photos).where(and(eq(schema.photos.ownerType,"check_result"),eq(schema.photos.ownerId,input.checkResultId),isNull(schema.photos.deletedAt))).all();
    const hash=pointContentHash(context.result.result,context.result.note,attached.map(p=>p.id));
    if(hash!==input.contentHash)throw new ValidationError("Poin ini baru berubah. Muat ulang dan periksa isi terbaru sebelum review.");
    const previous=tx.select({at:schema.checkResultReviews.createdAt}).from(schema.checkResultReviews).where(eq(schema.checkResultReviews.checkResultId,input.checkResultId)).orderBy(desc(schema.checkResultReviews.createdAt)).limit(1).get();
    const now=Math.max(Date.now(),(previous?.at??0)+1);
    tx.insert(schema.checkResultReviews).values({id:input.id,checkResultId:input.checkResultId,userId:user.id,verdict:input.verdict as "ok"|"not_ok",action,note:note||null,contentHash:hash,createdAt:now}).run();
    if(context.report.submittedBy!==user.id)tx.insert(schema.reviewNotifications).values({id:randomUUID(),recipientId:context.report.submittedBy,reviewId:input.id,createdAt:now}).run();
    tx.insert(schema.auditLogs).values({id:randomUUID(),userId:user.id,action:"checklist.reviewed",entityType:"check_result",entityId:input.checkResultId,metaJson:JSON.stringify({reviewId:input.id,verdict:input.verdict,action}),createdAt:now}).run();
    return {projectDayId:context.report.projectDayId,id:input.id};
  });
}

function inboxQuery(db:DB,user:ActingUser) {
  return db.select({id:schema.reviewNotifications.id,readAt:schema.reviewNotifications.readAt,createdAt:schema.reviewNotifications.createdAt,
    projectName:schema.projects.name,timezone:schema.projects.timezone,projectDayId:schema.reports.projectDayId,reportId:schema.reports.id,phase:schema.reports.phase,
    checkResultId:schema.reportCheckResults.id,label:schema.projectChecklistItems.label,verdict:schema.checkResultReviews.verdict,
    action:schema.checkResultReviews.action,note:schema.checkResultReviews.note,authorName:schema.users.name})
    .from(schema.reviewNotifications).innerJoin(schema.checkResultReviews,eq(schema.checkResultReviews.id,schema.reviewNotifications.reviewId))
    .innerJoin(schema.reportCheckResults,eq(schema.reportCheckResults.id,schema.checkResultReviews.checkResultId))
    .innerJoin(schema.reports,eq(schema.reports.id,schema.reportCheckResults.reportId))
    .innerJoin(schema.projects,eq(schema.projects.id,schema.reports.projectId))
    .innerJoin(schema.projectChecklistItems,eq(schema.projectChecklistItems.id,schema.reportCheckResults.projectChecklistItemId))
    .innerJoin(schema.users,eq(schema.users.id,schema.checkResultReviews.userId));
}
function inboxConditions(user:ActingUser) {
  return and(eq(schema.reviewNotifications.recipientId,user.id),isNull(schema.reports.deletedAt),isNull(schema.projects.deletedAt),visibleProjectPredicate(user));
}
export function listReviewNotifications(db:DB,user:ActingUser) {
  if(!user.isActive)return [];
  return inboxQuery(db,user).where(inboxConditions(user)).orderBy(desc(schema.reviewNotifications.createdAt)).limit(100).all();
}
export function unreadReviewCount(db:DB,user:ActingUser) {
  if(!user.isActive)return 0;
  // The projection is only an aggregate; no per-notification or per-project round trips.
  const query=inboxQuery(db,user).where(and(inboxConditions(user),isNull(schema.reviewNotifications.readAt))).as("inbox");
  return Number(db.select({count:sql<number>`count(*)`}).from(query).get()?.count??0);
}
export function openReviewNotification(db:DB,actor:ActingUser,id:string) {
  return db.transaction(tx=>{
    const user=freshActor(tx,actor);
    const row=inboxQuery(tx,user).where(and(inboxConditions(user),eq(schema.reviewNotifications.id,id))).get();
    if(!row)throw new ValidationError("Notifikasi tidak ditemukan atau akses project sudah berubah");
    if(row.readAt===null)tx.update(schema.reviewNotifications).set({readAt:Date.now()}).where(eq(schema.reviewNotifications.id,row.id)).run();
    return `/reports/day/${encodeURIComponent(row.projectDayId)}#point-${encodeURIComponent(row.checkResultId)}`;
  });
}
