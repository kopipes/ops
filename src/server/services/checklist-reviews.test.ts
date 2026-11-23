import Database from "better-sqlite3";
import {drizzle} from "drizzle-orm/better-sqlite3";
import {migrate} from "drizzle-orm/better-sqlite3/migrator";
import {resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {beforeEach,afterEach,describe,it,expect} from "vitest";
import * as schema from "@/server/db/schema";
import type {ActingUser} from "@/server/permissions";
import {visibleProjectIds} from "@/server/visibility";
import {addPointReview,listReviewNotifications,unreadReviewCount,openReviewNotification,pointContentHash} from "./checklist-reviews";
import {addPhotoReview,photoContentHash,listPhotoNotifications,unreadPhotoCount,openPhotoNotification} from './photo-reviews';
import {listAllReviewNotifications,allUnreadReviewCount} from './all-review-notifications';
import {getDayDetail,getDailySummary,markDayReviewed,dayReviewVersion} from "./reports-review";
import {applyReportEdit,getEditableReport} from "./report-edits";
let raw:Database.Database;let db:ReturnType<typeof drizzle<typeof schema>>;
const actor=(id:string,role:ActingUser['role']='user'):ActingUser=>({id,role,isActive:true,divisionIds:['d']});
const admin=actor('a','admin'),manager=actor('m','manager'),crew=actor('c'),corp=actor('co','corporate');
const hash=()=>pointContentHash('ok',null,[]);
const input=(over:Partial<Parameters<typeof addPointReview>[2]>={})=>({id:randomUUID(),checkResultId:'rc',verdict:'not_ok',action:'re_take_photo',note:'Foto kurang jelas',contentHash:hash(),...over});
beforeEach(()=>{
 raw=new Database(':memory:');raw.pragma('foreign_keys=ON');db=drizzle(raw,{schema});migrate(db,{migrationsFolder:resolve('src/server/db/migrations')});
 db.insert(schema.divisions).values({id:'d',code:'D',name:'Division'}).run();
 for(const user of [admin,manager,crew,corp,actor('other'),actor('outsider','manager')]) {
  db.insert(schema.users).values({id:user.id,name:user.id,email:user.id+'@test',passwordHash:'h',role:user.role,isActive:true,mustChangePassword:false,primaryDivisionId:'d'}).run();
  db.insert(schema.userDivisions).values({userId:user.id,divisionId:'d',isPrimary:true}).run();
 }
 db.insert(schema.projects).values({id:'p',code:'P',name:'Project',venue:'Venue',startDate:'2026-11-18',endDate:'2026-11-18',timezone:'Asia/Jakarta',ownerDivisionId:'d',status:'active'}).run();
 for(const user of [manager,crew,actor('other')])db.insert(schema.projectMembers).values({projectId:'p',userId:user.id,roleInProject:'crew',isActive:true}).run();
 db.insert(schema.projectDays).values({id:'day',projectId:'p',date:'2026-11-18',dayType:'event'}).run();
 db.insert(schema.projectChecklistItems).values({id:'item',projectId:'p',phase:'monitoring',categoryName:'Area',label:'Kondisi area',isRequired:true,requiresPhoto:false,sortOrder:0,isActive:true}).run();
 db.insert(schema.reports).values({id:'r',projectId:'p',projectDayId:'day',phase:'monitoring',submittedBy:'c',clientSubmissionId:'client',status:'submitted',observedAt:1794970800000,submittedAt:100,createdAt:100,updatedAt:100}).run();
 db.insert(schema.reportCheckResults).values({id:'rc',reportId:'r',projectChecklistItemId:'item',result:'ok',note:null}).run();
});
afterEach(()=>raw.close());
function photo(id:string,ownerType:'report'|'check_result'='report',ownerId='c',uploader='c') {db.insert(schema.photos).values({id,ownerType,ownerId,projectId:'p',projectDayId:'day',uploadedBy:uploader,path:id+'.jpg',thumbPath:id+'t.jpg',mime:'image/jpeg',width:20,height:20,sizeBytes:200,source:'gallery'}).run();}
describe('point feedback and notifications',()=>{
 it('saves review separately, notifies author, and an identical retry stays idempotent',()=>{
  const request=input();addPointReview(db,manager,request);addPointReview(db,manager,request);
  expect(raw.prepare('select result,note from report_check_results').get()).toEqual({result:'ok',note:null});
  expect(raw.prepare('select count(*) n from check_result_reviews').get()).toEqual({n:1});
  const inbox=listReviewNotifications(db,crew);expect(inbox).toHaveLength(1);expect(inbox[0].label).toBe('Kondisi area');expect(unreadReviewCount(db,crew)).toBe(1);
  expect(openReviewNotification(db,crew,inbox[0].id)).toBe('/reports/day/day#point-rc');expect(unreadReviewCount(db,crew)).toBe(0);
 });
 it.each([admin,corp,manager])('authorized reviewer $role can review',user=>{expect(()=>addPointReview(db,user,input())).not.toThrow();});
 it.each([crew,actor('outsider','manager')])('denies crew and same-division nonmember reviewer $id',user=>{expect(()=>addPointReview(db,user,input())).toThrow();});
 it('blocks revoked/deactivated roles using fresh DB facts',()=>{
  raw.prepare("update users set role='user' where id='m'").run();expect(()=>addPointReview(db,manager,input())).toThrow();
  raw.prepare("update users set is_active=0 where id='a'").run();expect(()=>addPointReview(db,admin,input())).toThrow();
 });
 it('requires an action for Not OK, a note for Others, and rejects stale page state',()=>{
  expect(()=>addPointReview(db,manager,input({action:'others',note:' '}))).toThrow('Isi catatan perbaikan');expect(()=>addPointReview(db,manager,input({action:'bogus'}))).toThrow();
  raw.prepare("update report_check_results set note='changed' where id='rc'").run();expect(()=>addPointReview(db,manager,input())).toThrow(/berubah/);
  expect(listReviewNotifications(db,crew)).toHaveLength(0);
 });
 it('lets a Manager request Re-Take without typing a note and notifies the author once',()=>{
  const request=input({note:""});
  addPointReview(db,manager,request);
  addPointReview(db,manager,request);
  expect(listReviewNotifications(db,crew)).toMatchObject([{action:"re_take_photo",note:"Ambil ulang foto."}]);
 });
 it('does not notify self and another recipient cannot open the notification',()=>{
  raw.prepare("update reports set submitted_by='m'").run();addPointReview(db,manager,input());expect(unreadReviewCount(db,manager)).toBe(0);
  raw.prepare("update reports set submitted_by='c'").run();addPointReview(db,admin,input());const row=listReviewNotifications(db,crew)[0];expect(()=>openReviewNotification(db,actor('other'),row.id)).toThrow();
 });
 it('hides inbox entries after membership revocation or project deletion',async()=>{
  addPointReview(db,manager,input());raw.prepare("update project_members set is_active=0 where user_id='c'").run();
  expect(listReviewNotifications(db,crew)).toEqual([]);expect(unreadReviewCount(db,crew)).toBe(0);expect(await visibleProjectIds(db,crew)).toEqual([]);
  raw.prepare("update project_members set is_active=1 where user_id='c'").run();raw.prepare('update projects set deleted_at=1000').run();expect(listReviewNotifications(db,crew)).toEqual([]);
 });
 it('keeps all feedback history and includes photos under the exact point',async()=>{
  addPointReview(db,manager,input());photo('photo','check_result','rc');
  const detail=await getDayDetail(db,crew,'p','2026-11-18');const result=detail!.monitoring[0].results[0];expect(result.photoIds).toEqual(['photo']);expect(result.reviews[0].contentHash).not.toBe(result.contentHash);expect(detail!.monitoring[0].photos).toEqual([]);
  addPointReview(db,admin,input({verdict:'ok',action:'',note:'Sudah baik',contentHash:result.contentHash}));
  const after=await getDayDetail(db,crew,'p','2026-11-18');expect(after!.monitoring[0].results[0].reviews).toHaveLength(2);
 });
 it('rejects a replay ID for another payload and rolls back a failed notification',()=>{
  const request=input();addPointReview(db,manager,request);expect(()=>addPointReview(db,manager,{...request,note:'different'})).toThrow();
  raw.exec("create trigger fail_notification before insert on review_notifications begin select raise(abort,'simulated write failure'); end;");
  expect(()=>addPointReview(db,admin,input())).toThrow();expect(raw.prepare('select count(*) n from check_result_reviews').get()).toEqual({n:1});
 });
});
describe('unlocked editing and exact correction',()=>{
 it('refuses day review from a stale page without marking newer contents reviewed',async()=>{
  const version=dayReviewVersion([{id:'r',updatedAt:100}]);
  raw.prepare("update reports set updated_at=500 where id='r'").run();
  await expect(markDayReviewed(db,manager,'day',version)).rejects.toThrow(/berubah/);
  expect(raw.prepare("select reviewed_at from project_days where id='day'").get()).toEqual({reviewed_at:null});
  await markDayReviewed(db,manager,'day',dayReviewVersion([{id:'r',updatedAt:500}]));
  expect((await getDayDetail(db,crew,'p','2026-11-18'))!.day.changedSinceReview).toBe(false);
 });
 it('exposes correction controls only to authors and authorized managers/admin',async()=>{
  expect((await getDayDetail(db,crew,'p','2026-11-18'))!.monitoring[0].canEdit).toBe(true);
  expect((await getDayDetail(db,actor('other'),'p','2026-11-18'))!.monitoring[0].canEdit).toBe(false);
  expect((await getDayDetail(db,corp,'p','2026-11-18'))!.monitoring[0].canEdit).toBe(false);
 });
 it('author edits old reviewed reports, keeps original submit time and history; re-review clears stale badge',async()=>{
  raw.prepare("update project_days set reviewed_at=200,reviewed_by='m'").run();
  await applyReportEdit(db,raw,crew,'r',{notes:'koreksi',results:[{projectChecklistItemId:'item',result:'ok',note:'Sudah dicek',photoIds:[]}]});
  const loaded=await getEditableReport(db,crew,'r');expect(loaded?.canEdit).toBe(true);expect(loaded!.report.submittedAt).toBe(100);expect(loaded!.report.editCount).toBe(1);
  expect((await getDayDetail(db,crew,'p','2026-11-18'))!.day.changedSinceReview).toBe(true);
  expect((await getDailySummary(db,['p'],{from:'2026-11-18',to:'2026-11-18'}))[0].changedSinceReview).toBe(true);
  await markDayReviewed(db,manager,'day');expect((await getDayDetail(db,crew,'p','2026-11-18'))!.day.changedSinceReview).toBe(false);
 });
 it('claims only own new photos atomically and preserves old photo history',async()=>{
  photo('old','check_result','rc');photo('new');
  await applyReportEdit(db,raw,crew,'r',{notes:null,results:[{projectChecklistItemId:'item',result:'ok',note:null,photoIds:['new']}]});
  const loaded=await getEditableReport(db,crew,'r');expect(loaded!.report.results[0].photoIds.sort()).toEqual(['new','old']);expect(loaded!.report.editCount).toBe(1);
  expect(raw.prepare("select owner_type,owner_id from photos where id='new'").get()).toEqual({owner_type:'check_result',owner_id:'rc'});
  expect(()=>addPointReview(db,manager,input())).toThrow(/berubah/);
 });
 it('rejects stolen/already attached photos and stale edit versions',async()=>{
  photo('stolen','report','other','other');
  await expect(applyReportEdit(db,raw,crew,'r',{notes:'x',results:[{projectChecklistItemId:'item',result:'ok',note:null,photoIds:['stolen']}]})).rejects.toThrow(/Photo|Foto/);
  await expect(applyReportEdit(db,raw,crew,'r',{expectedUpdatedAt:1,notes:'x',results:[{projectChecklistItemId:'item',result:'ok',note:null,photoIds:[]}]})).rejects.toThrow(/diubah/);
  expect(raw.prepare('select count(*) n from report_revisions').get()).toEqual({n:0});
 });
});

describe('general report photos, including monitoring without checklist answers',()=>{
 const feedback=(photoId='original',over:Partial<Parameters<typeof addPhotoReview>[2]>={})=>({id:randomUUID(),photoId,verdict:'not_ok',action:'re_take_photo',note:'Foto sisi kiri buram',contentHash:photoContentHash(photoId,[]),...over});
 it('reviews a general photo and notifies the original author without needing a checklist',async()=>{
  raw.prepare('delete from report_check_results').run();photo('original','report','r');
  const request=feedback();addPhotoReview(db,manager,request);addPhotoReview(db,manager,request);
  expect(unreadPhotoCount(db,crew)).toBe(1);expect(allUnreadReviewCount(db,crew)).toBe(1);
  const notification=listPhotoNotifications(db,crew)[0];expect(listAllReviewNotifications(db,crew)[0].kind).toBe('photo');
  expect(openPhotoNotification(db,crew,notification.id)).toBe('/reports/day/day#photo-original');expect(unreadPhotoCount(db,crew)).toBe(0);
  expect(()=>openPhotoNotification(db,actor('other'),notification.id)).toThrow();
  const detail=await getDayDetail(db,crew,'p','2026-11-18');expect(detail!.monitoring[0].results).toEqual([]);expect(detail!.monitoring[0].photos[0].reviews[0].note).toBe('Foto sisi kiri buram');
 });
 it('adds a linked replacement with version history, retains original, and marks the photo review stale',async()=>{
  photo('original','report','r');photo('replacement');addPhotoReview(db,manager,feedback());
  await applyReportEdit(db,raw,crew,'r',{notes:null,results:[{projectChecklistItemId:'item',result:'ok',note:null,photoIds:[]}],replacementPhotos:[{photoId:'replacement',targetPhotoId:'original'}]});
  const detail=await getDayDetail(db,crew,'p','2026-11-18');const group=detail!.monitoring[0].photos[0];expect(detail!.monitoring[0].photos).toHaveLength(1);expect(group.replacementIds).toEqual(['replacement']);expect(group.contentHash).not.toBe(group.reviews[0].contentHash);
  expect(raw.prepare("select owner_id,replaces_photo_id from photos where id='replacement'").get()).toEqual({owner_id:'r',replaces_photo_id:'original'});expect(raw.prepare("select deleted_at from photos where id='original'").get()).toEqual({deleted_at:null});
  expect((await getEditableReport(db,crew,'r'))!.report.editCount).toBe(1);
  expect(()=>addPhotoReview(db,manager,feedback())).toThrow(/berubah/);
  addPhotoReview(db,admin,feedback('original',{verdict:'ok',action:'',note:'Sudah jelas',contentHash:group.contentHash}));
  expect((await getDayDetail(db,crew,'p','2026-11-18'))!.monitoring[0].photos[0].reviews).toHaveLength(2);
 });
 it('rejects provisional, per-checklist, deleted, nonmember and stale account photo review targets',()=>{
  photo('draft');photo('point','check_result','rc');photo('original','report','r');
  expect(()=>addPhotoReview(db,manager,feedback('draft'))).toThrow();expect(()=>addPhotoReview(db,manager,feedback('point'))).toThrow();expect(()=>addPhotoReview(db,actor('outsider','manager'),feedback())).toThrow();
  raw.prepare("update users set role='user' where id='m'").run();expect(()=>addPhotoReview(db,manager,feedback())).toThrow();
  raw.prepare("update photos set deleted_at=1 where id='original'").run();expect(()=>addPhotoReview(db,admin,feedback())).toThrow();
 });
 it('does not notify self and hides existing photo notifications after membership is revoked',()=>{
  photo('original','report','r');raw.prepare("update reports set submitted_by='m'").run();addPhotoReview(db,manager,feedback());expect(unreadPhotoCount(db,manager)).toBe(0);
  raw.prepare("update reports set submitted_by='c'").run();addPhotoReview(db,admin,feedback());const id=listPhotoNotifications(db,crew)[0].id;
  raw.prepare("update project_members set is_active=0 where user_id='c'").run();expect(listPhotoNotifications(db,crew)).toEqual([]);expect(()=>openPhotoNotification(db,crew,id)).toThrow();
 });
 it('rejects a replacement of another report photo and leaves both reports untouched',async()=>{
  photo('original','report','another-report');photo('new');
  await expect(applyReportEdit(db,raw,crew,'r',{notes:'x',results:[{projectChecklistItemId:'item',result:'ok',note:null,photoIds:[]}],replacementPhotos:[{photoId:'new',targetPhotoId:'original'}]})).rejects.toThrow(/asal/);
  expect(raw.prepare('select count(*) n from report_revisions').get()).toEqual({n:0});
 });
});
