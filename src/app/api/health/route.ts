/**
 * Liveness/readiness probe used by the Docker HEALTHCHECK.
 * Verifies the database is actually reachable — not just that Node is up.
 */
import { NextResponse } from "next/server";
import { getRawDb } from "@/server/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getRawDb();
    db.prepare("select 1 as ok").get();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[health]", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
