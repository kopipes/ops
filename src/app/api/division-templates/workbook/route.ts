import { currentSession } from "@/server/auth/current-user";
import { canCreateProject } from "@/server/permissions";
import { getDb } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";
import { listTemplateDivisions, readDivisionTemplate } from "@/server/services/division-templates";
import { divisionTemplateWorkbook } from "@/server/services/division-template-workbook";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await currentSession();
  if (!session) return new Response("Silakan login kembali.", { status: 401 });
  if (session.mustChangePassword || !canCreateProject(session.user)) return new Response("Akses ditolak.", { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  try {
    const db = getDb();
    const template = id ? readDivisionTemplate(db, session.user, id) : null;
    if (!id) listTemplateDivisions(db, session.user);
    const name = template ? template.name.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 70) || "checklist" : "template-divisi-pulse";
    const bytes = await divisionTemplateWorkbook(template?.rows);
    return new Response(bytes, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name}.xlsx"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ValidationError) return new Response("Template tidak tersedia.", { status: 404 });
    console.error("[template workbook]", error);
    return new Response("Unduhan gagal. Coba lagi.", { status: 500 });
  }
}
