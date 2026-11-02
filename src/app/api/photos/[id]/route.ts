/**
 * Authenticated photo serving (§8.3).
 *
 * Photos are NOT static files: every request is checked against project
 * visibility so a guessed URL cannot leak another division's event photos.
 * Long-lived immutable caching is still safe because the URL is unguessable
 * and the auth check runs first.
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { photos } from "@/server/db/schema";
import { currentSession } from "@/server/auth/current-user";
import { readPhotoFile } from "@/server/services/photos";
import { canViewProject } from "@/server/permissions";
import { loadFacts } from "@/server/services/projects";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await currentSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { id } = await params;
  const url = new URL(request.url);
  const variant = url.searchParams.get("v") === "thumb" ? "thumb" : "main";

  const db = getDb();
  const row = await db
    .select({ projectId: photos.projectId })
    .from(photos)
    .where(eq(photos.id, id))
    .get();
  if (!row) return new NextResponse("Not found", { status: 404 });

  try {
    const facts = await loadFacts(db, row.projectId);
    if (!canViewProject(session.user, facts)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const file = await readPhotoFile(db, id, variant);
  if (!file) return new NextResponse("Not found", { status: 404 });

  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
