/**
 * Authenticated photo serving (§8.3).
 *
 * Photos are NOT static files: every request is checked against project
 * visibility so a guessed URL cannot leak another division's event photos.
 * Long-lived immutable caching is still safe because the URL is unguessable
 * and the auth check runs first.
 */
import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db";
import { issues, photos, reportCheckResults, reports } from "@/server/db/schema";
import { currentSession } from "@/server/auth/current-user";
import { readPhotoFile } from "@/server/services/photos";
import { canViewProject, isReportOnlyProjectMember } from "@/server/permissions";
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
    .select({ projectId: photos.projectId, ownerId: photos.ownerId, ownerType: photos.ownerType })
    .from(photos)
    .where(eq(photos.id, id))
    .get();
  if (!row) return new NextResponse("Not found", { status: 404 });

  try {
    const facts = await loadFacts(db, row.projectId);
    if (!canViewProject(session.user, facts)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    if (isReportOnlyProjectMember(session.user, facts)) {
      const reportId = row.ownerType === "report" ? row.ownerId : row.ownerType === "check_result"
        ? db.select({ id: reportCheckResults.reportId }).from(reportCheckResults).where(eq(reportCheckResults.id, row.ownerId)).get()?.id
        : undefined;
      const attachedToReport = reportId && db.select({ id: reports.id }).from(reports).where(and(
        eq(reports.id, reportId), eq(reports.projectId, row.projectId), eq(reports.status, "submitted"), isNull(reports.deletedAt),
      )).get();
      const attachedToIssue = row.ownerType === "issue" && db.select({ id: issues.id }).from(issues).where(and(
        eq(issues.id, row.ownerId), eq(issues.projectId, row.projectId), isNull(issues.deletedAt),
      )).get();
      if (!attachedToReport && !attachedToIssue) return new NextResponse("Forbidden", { status: 403 });
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
