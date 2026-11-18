import {randomUUID} from "node:crypto";
import {and,desc,eq,inArray,isNull,sql} from "drizzle-orm";
import type {BetterSQLite3Database} from "drizzle-orm/better-sqlite3";
import * as s from "@/server/db/schema";
import {canReviewDay,type ActingUser} from "@/server/permissions";
import {visibleProjectPredicate} from "@/server/visibility";
import {currentProjectAccess} from "./project-access";
import {ForbiddenError,ValidationError} from "./checklist-items";
import {pointContentHash,REVIEW_ACTION_LABELS,type ReviewAction,type PointReview} from "./checklist-reviews";
type DB=BetterSQLite3Database<typeof s>;
export function photoContentHash(photoId:string,replacementIds:string[]){return pointContentHash('photo',photoId,replacementIds);}
export function photoFeedback(db:DB,ids:string[]) {
 if(!ids.length)return [];
 return db.select({id:s.photoReviews.id,photoId:s.photoReviews.photoId,userId:s.photoReviews.userId,verdict:s.photoReviews.verdict,action:s.photoReviews.action,note:s.photoReviews.note,contentHash:s.photoReviews.contentHash,createdAt:s.photoReviews.createdAt,authorName:s.users.name}).from(s.photoReviews).innerJoin(s.users,eq(s.users.id,s.photoReviews.userId)).where(inArray(s.photoReviews.photoId,ids)).orderBy(desc(s.photoReviews.createdAt),desc(s.photoReviews.id)).all();
}
export function addPhotoReview(db:DB,actor:ActingUser,input:{id:string;photoId:string;verdict:string;action:string;note:string;contentHash:string}) {
 const note=input.note.trim();
 if(!/^[0-9a-f-]{36}$/i.test(input.id)||!['ok','not_ok'].includes(input.verdict)||note.length>2000)throw new ValidationError('Review foto tidak valid');
 if(input.verdict==='not_ok'&&(!Object.hasOwn(REVIEW_ACTION_LABELS,input.action)||!note))throw new ValidationError('Pilih tindak lanjut dan isi komentar perbaikan');
 return db.transaction(tx=>{
  const context=tx.select({photo:s.photos,report:s.reports}).from(s.photos).innerJoin(s.reports,eq(s.reports.id,s.photos.ownerId)).where(and(eq(s.photos.id,input.photoId),eq(s.photos.ownerType,'report'),isNull(s.photos.deletedAt),isNull(s.reports.deletedAt),eq(s.reports.status,'submitted'))).get();
  if(!context||context.photo.projectId!==context.report.projectId||context.photo.projectDayId!==context.report.projectDayId||context.photo.replacesPhotoId)throw new ValidationError('Foto laporan asli tidak ditemukan');
  const {user,facts}=currentProjectAccess(tx,actor,context.report.projectId);
  if(!canReviewDay(user,facts))throw new ForbiddenError('Kamu tidak berhak mereview foto ini');
  const action=input.verdict==='not_ok'?input.action as ReviewAction:null;
  const prior=tx.select().from(s.photoReviews).where(eq(s.photoReviews.id,input.id)).get();
  if(prior){if(prior.userId!==user.id||prior.photoId!==input.photoId||prior.verdict!==input.verdict||prior.action!==action||prior.note!==(note||null)||prior.contentHash!==input.contentHash)throw new ValidationError('Review sudah digunakan. Muat ulang halaman.');return {id:prior.id,projectDayId:context.report.projectDayId};}
  const replacements=tx.select({id:s.photos.id}).from(s.photos).where(and(eq(s.photos.replacesPhotoId,input.photoId),eq(s.photos.ownerType,'report'),eq(s.photos.ownerId,context.report.id),isNull(s.photos.deletedAt))).all();
  const hash=photoContentHash(input.photoId,replacements.map(p=>p.id));
  if(hash!==input.contentHash)throw new ValidationError('Foto baru berubah. Muat ulang dan periksa foto terbaru.');
  const previous=tx.select({at:s.photoReviews.createdAt}).from(s.photoReviews).where(eq(s.photoReviews.photoId,input.photoId)).orderBy(desc(s.photoReviews.createdAt)).limit(1).get();
  const now=Math.max(Date.now(),(previous?.at??0)+1);
  tx.insert(s.photoReviews).values({id:input.id,photoId:input.photoId,userId:user.id,verdict:input.verdict as 'ok'|'not_ok',action,note:note||null,contentHash:hash,createdAt:now}).run();
  if(context.report.submittedBy!==user.id)tx.insert(s.photoReviewNotifications).values({id:randomUUID(),recipientId:context.report.submittedBy,reviewId:input.id,createdAt:now}).run();
  tx.insert(s.auditLogs).values({id:randomUUID(),userId:user.id,action:'photo.reviewed',entityType:'photo',entityId:input.photoId,metaJson:JSON.stringify({reviewId:input.id,verdict:input.verdict,action}),createdAt:now}).run();
  return {id:input.id,projectDayId:context.report.projectDayId};
 });
}
function query(db:DB) {
 return db.select({id:s.photoReviewNotifications.id,readAt:s.photoReviewNotifications.readAt,createdAt:s.photoReviewNotifications.createdAt,projectName:s.projects.name,timezone:s.projects.timezone,projectDayId:s.reports.projectDayId,reportId:s.reports.id,phase:s.reports.phase,photoId:s.photos.id,label:sql<string>`'Foto laporan'`,verdict:s.photoReviews.verdict,action:s.photoReviews.action,note:s.photoReviews.note,authorName:s.users.name})
 .from(s.photoReviewNotifications).innerJoin(s.photoReviews,eq(s.photoReviews.id,s.photoReviewNotifications.reviewId)).innerJoin(s.photos,eq(s.photos.id,s.photoReviews.photoId)).innerJoin(s.reports,eq(s.reports.id,s.photos.ownerId)).innerJoin(s.projects,eq(s.projects.id,s.reports.projectId)).innerJoin(s.users,eq(s.users.id,s.photoReviews.userId));
}
const conditions=(user:ActingUser)=>and(eq(s.photoReviewNotifications.recipientId,user.id),eq(s.photos.ownerType,'report'),isNull(s.photos.deletedAt),isNull(s.reports.deletedAt),isNull(s.projects.deletedAt),visibleProjectPredicate(user));
export function listPhotoNotifications(db:DB,user:ActingUser){return user.isActive?query(db).where(conditions(user)).orderBy(desc(s.photoReviewNotifications.createdAt)).limit(100).all():[];}
export function unreadPhotoCount(db:DB,user:ActingUser){if(!user.isActive)return 0;const inbox=query(db).where(and(conditions(user),isNull(s.photoReviewNotifications.readAt))).as('photo_inbox');return Number(db.select({count:sql<number>`count(*)`}).from(inbox).get()?.count??0);}
export function openPhotoNotification(db:DB,actor:ActingUser,id:string) {
 return db.transaction(tx=>{
  // Account/role is reloaded by the session; per-project access is rechecked here.
  const row=query(tx).where(and(conditions(actor),eq(s.photoReviewNotifications.id,id))).get();
  if(!row)throw new ValidationError('Notifikasi tidak tersedia atau akses project berubah');
  const project=tx.select({projectId:s.reports.projectId}).from(s.reports).where(eq(s.reports.id,row.reportId)).get()!;
  const {user}=currentProjectAccess(tx,actor,project.projectId);
  // Prevent a stale global role from granting access after demotion.
  const fresh=query(tx).where(and(conditions(user),eq(s.photoReviewNotifications.id,id))).get();if(!fresh)throw new ForbiddenError();
  if(row.readAt===null)tx.update(s.photoReviewNotifications).set({readAt:Date.now()}).where(eq(s.photoReviewNotifications.id,id)).run();
  return `/reports/day/${encodeURIComponent(row.projectDayId)}#photo-${encodeURIComponent(row.photoId)}`;
 });
}
