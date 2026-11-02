/**
 * Photo upload endpoint (§8.3, §8.4).
 *
 * Streamed per photo right after selection so submit stays fast, and it can be
 * retried independently (§8.4). There is deliberately NO per-report count cap
 * (§8.1) — only the 15 MB per-file limit.
 */
import { NextResponse } from "next/server";
import { getDb } from "@/server/db";
import { currentSession } from "@/server/auth/current-user";
import { storePhoto } from "@/server/services/photos";
import { canSubmitMonitoring } from "@/server/permissions";
import { loadFacts } from "@/server/services/projects";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) {
    return NextResponse.json({ error: "Tidak terautentikasi" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Body tidak valid" }, { status: 400 });
  }

  const projectId = String(form.get("projectId") ?? "");
  const projectDayIdRaw = String(form.get("projectDayId") ?? "");
  const file = form.get("file");
  const sourceRaw = String(form.get("source") ?? "gallery");
  const takenAtRaw = Number(form.get("takenAt"));
  const clientUploadId = String(form.get("clientUploadId") ?? "").trim() || null;

  if (!projectId || !(file instanceof File)) {
    return NextResponse.json({ error: "projectId dan file wajib dikirim" }, { status: 400 });
  }

  try {
    const db = getDb();
    const facts = await loadFacts(db, projectId);

    // Only people who may file a report on this project may upload to it.
    if (!canSubmitMonitoring(session.user, facts)) throw new ForbiddenError();

    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await storePhoto(db, session.user, {
      buffer,
      filename: file.name,
      source: sourceRaw === "camera" ? "camera" : "gallery",
      takenAt: Number.isFinite(takenAtRaw) && takenAtRaw > 0 ? takenAtRaw : null,
      projectId,
      projectDayId: projectDayIdRaw || null,
      // Provisional: owned by the uploader until the report links it.
      ownerType: "report",
      ownerId: session.user.id,
      clientUploadId,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: "Tidak punya akses ke project ini" }, { status: 403 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[photo upload]", err);
    return NextResponse.json({ error: "Upload gagal" }, { status: 500 });
  }
}
