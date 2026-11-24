import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentSession } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { canCreateProject } from "@/server/permissions";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";
import { IMPORT_MAX_BYTES, parseChecklistWorkbook } from "@/server/services/checklist-import";
import { commitDivisionTemplateExcel, previewDivisionTemplateExcel } from "@/server/services/division-templates";

export const runtime = "nodejs";
const BODY_LIMIT = IMPORT_MAX_BYTES + 64 * 1024;

async function readForm(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError("Pilih file Excel.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) {
        await reader.cancel();
        throw new ValidationError("File .xlsx maksimal 2 MB.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return await new Response(Buffer.concat(chunks, size), {
      headers: { "Content-Type": request.headers.get("content-type") ?? "" },
    }).formData();
  } catch {
    throw new ValidationError("File Excel tidak dapat dibaca.");
  }
}

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: "Silakan login kembali." }, { status: 401 });
  if (session.mustChangePassword || !canCreateProject(session.user)) {
    return NextResponse.json({ error: "Hanya Admin dan Manager yang dapat mengimpor checklist." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.APP_URL || request.url).origin) {
    return NextResponse.json({ error: "Asal permintaan tidak valid." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length")) > BODY_LIMIT) {
    return NextResponse.json({ error: "File .xlsx maksimal 2 MB." }, { status: 413 });
  }
  try {
    const form = await readForm(request);
    const file = form.get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size > IMPORT_MAX_BYTES) {
      throw new ValidationError("Pilih file .xlsx maksimal 2 MB.");
    }
    const target = {
      templateId: String(form.get("templateId") ?? ""),
      divisionId: String(form.get("divisionId") ?? ""),
      name: String(form.get("templateName") ?? "").trim(),
      requestId: String(form.get("requestId") ?? ""),
    };
    if (!/^[0-9a-f-]{36}$/i.test(target.requestId)) throw new ValidationError("Periksa file sebelum menyimpan.");
    const rows = await parseChecklistWorkbook(Buffer.from(await file.arrayBuffer()));
    const db = getDb();
    if (form.get("mode") === "preview") {
      return NextResponse.json({ preview: previewDivisionTemplateExcel(db, session.user, rows, target) });
    }
    if (form.get("mode") !== "commit") throw new ValidationError("Tindakan tidak valid.");
    const templateId = commitDivisionTemplateExcel(db, session.user, rows, target, String(form.get("hash") ?? ""));
    for (const path of ["/master/templates", `/master/templates/${templateId}`, "/projects/new", "/admin/audit"]) revalidatePath(path);
    return NextResponse.json({ templateId });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: error instanceof ForbiddenError ? 403 : 400 });
    }
    console.error("[template import]", error);
    return NextResponse.json({ error: "Impor gagal. Periksa file lalu coba lagi." }, { status: 500 });
  }
}
