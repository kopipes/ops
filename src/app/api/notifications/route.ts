import {NextResponse} from "next/server";
import {currentSession} from "@/server/auth/current-user";
import {getDb} from "@/server/db";
import {allUnreadReviewCount} from "@/server/services/all-review-notifications";
export async function GET() {
  const session=await currentSession();
  if(!session||session.mustChangePassword)return NextResponse.json({error:"Tidak terautentikasi"},{status:401});
  return NextResponse.json({unread:allUnreadReviewCount(getDb(),session.user)},{headers:{"Cache-Control":"private, no-store"}});
}
