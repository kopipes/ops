import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { currentSession } from "@/server/auth/current-user";
import { getDb } from "@/server/db";
import { ForbiddenError, ValidationError } from "@/server/services/checklist-items";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({error:"Silakan login kembali"},{status:401});
  if (session.mustChangePassword || !session.user.isActive || !["admin","manager"].includes(session.user.role)) return NextResponse.json({error:"Hanya Admin dan Manager yang dapat mengimpor checklist"},{status:403});
  const origin=request.headers.get("origin");
  if(origin && origin !== new URL(process.env.APP_URL || request.url).origin) return NextResponse.json({error:"Asal permintaan tidak valid"},{status:403});
  if(Number(request.headers.get("content-length"))>3*1024*1024)return NextResponse.json({error:"File .xlsx maksimal 2 MB"},{status:413});
  try {
    const form=await request.formData(),file=form.get("file");
    if(!(file instanceof File)||!file.name.toLowerCase().endsWith(".xlsx")||file.size>2*1024*1024)throw new ValidationError("Pilih file .xlsx maksimal 2 MB");
    const {parseChecklistWorkbook,previewChecklistImport,commitChecklistImport}=await import("@/server/services/checklist-import");
    const rows=await parseChecklistWorkbook(Buffer.from(await file.arrayBuffer()));
    const division=String(form.get("divisionId")??"").trim(),name=String(form.get("templateName")??"").trim();
    if(form.get("mode")==="preview") return NextResponse.json({preview:previewChecklistImport(getDb(),session.user,rows,division,name)});
    if(form.get("mode")!=="commit")throw new ValidationError("Tindakan tidak valid");
    const result=commitChecklistImport(getDb(),session.user,rows,division,name,String(form.get("hash")??""));
    revalidatePath("/master/checklist-items");revalidatePath("/master/templates");revalidatePath("/projects/new");revalidatePath("/admin/audit");
    return NextResponse.json({result});
  } catch(error) {
    if(error instanceof ForbiddenError || error instanceof ValidationError)return NextResponse.json({error:error.message},{status:error instanceof ForbiddenError?403:400});
    console.error("[checklist import]",error);return NextResponse.json({error:"Impor gagal. Tidak ada item yang disimpan. Periksa file lalu coba lagi."},{status:500});
  }
}
