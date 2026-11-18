import {NextResponse} from "next/server";
import {currentSession} from "@/server/auth/current-user";
import {getDb} from "@/server/db";
import {unreadReviewCount} from "@/server/services/checklist-reviews";
export async function GET() {
  const session=await currentSession();
  if(!session||session.mustChangePassword)return NextResponse.json({error:"Tidak terautentikasi"},{status:401});
  return NextResponse.json({unread:unreadReviewCount(getDb(),session.user)},{headers:{"Cache-Control":"private, no-store"}});
}
