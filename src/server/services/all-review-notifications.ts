import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import type * as schema from '@/server/db/schema';
import type {ActingUser} from '@/server/permissions';
import {listReviewNotifications,unreadReviewCount,openReviewNotification} from './checklist-reviews';
import {listPhotoNotifications,unreadPhotoCount,openPhotoNotification} from './photo-reviews';
import {ValidationError} from './checklist-items';
type DB=BetterSQLite3Database<typeof schema>;
export function listAllReviewNotifications(db:DB,user:ActingUser){return [
 ...listReviewNotifications(db,user).map(row=>({...row,kind:'point' as const,photoId:null})),
 ...listPhotoNotifications(db,user).map(row=>({...row,kind:'photo' as const,checkResultId:null})),
].sort((a,b)=>b.createdAt-a.createdAt||b.id.localeCompare(a.id)).slice(0,100);}
export function allUnreadReviewCount(db:DB,user:ActingUser){return unreadReviewCount(db,user)+unreadPhotoCount(db,user);}
export function openAnyReviewNotification(db:DB,user:ActingUser,id:string,kind:string){
 if(kind==='photo')return openPhotoNotification(db,user,id);
 if(kind==='point')return openReviewNotification(db,user,id);
 throw new ValidationError('Jenis notifikasi tidak valid');
}
