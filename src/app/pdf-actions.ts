"use server";

/**
 * PDF export actions (§7.5).
 *
 * The client posts the options, the server:
 *   1. re-checks permissions and the date-range cap,
 *   2. builds an absolute URL to the internal /print route,
 *   3. renders through the single-job Chromium queue,
 *   4. streams the PDF back as a download.
 *
 * The renderer's session is the CALLER's session because Chromium requests the
 * print route over localhost with the forwarded cookie — so the print page sees
 * the same authorization the action already checked.
 */
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { requireUser } from "@/server/auth/current-user";
import { projectDays, projects } from "@/server/db/schema";
import { canExportPdf } from "@/server/permissions";
import { loadFacts } from "@/server/services/projects";
import { dateRange } from "@/lib/datetime";
import { MAX_RECAP_DAYS, PdfTimeoutError, renderPdf } from "@/server/pdf/render";
import { pdfOrigin } from "@/server/pdf/origin";

export interface ExportResult {
  ok?: boolean;
  error?: string;
  /** Base64 payload; the browser turns it into a download. */
  filename?: string;
  dataUrl?: string;
}

export async function exportDailyPdfAction(
  _prev: ExportResult,
  formData: FormData,
): Promise<ExportResult> {
  const session = await requireUser();
  const db = getDb();

  const projectDayId = String(formData.get("projectDayId") ?? "");
  const includePhotos = formData.get("includePhotos") === "on";
  const clientMode = formData.get("clientMode") === "on";

  const day = await db.select().from(projectDays).where(eq(projectDays.id, projectDayId)).get();
  if (!day) return { error: "Hari tidak ditemukan" };

  const facts = await loadFacts(db, day.projectId);
  if (!canExportPdf(session.user, facts)) {
    return { error: "Kamu tidak berhak mengekspor laporan ini" };
  }

  const project = await db.select().from(projects).where(eq(projects.id, day.projectId)).get();
  if (!project) return { error: "Project tidak ditemukan" };

  const jar = await headers();
  const origin = pdfOrigin(jar);
  const cookie = jar.get("cookie") ?? "";
  const qs = new URLSearchParams({
    photos: includePhotos ? "1" : "0",
    client: clientMode ? "1" : "0",
  });

  const url = `${origin}/print/day/${projectDayId}?${qs.toString()}`;

  try {
    const pdf = await renderPdfWithCookie(url, cookie);
    const filename = `laporan-${project.code}-${day.date}.pdf`;
    return {
      ok: true,
      filename,
      dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}`,
    };
  } catch (err) {
    return { error: pdfErrorMessage(err) };
  }
}

export async function exportProjectPdfAction(
  _prev: ExportResult,
  formData: FormData,
): Promise<ExportResult> {
  const session = await requireUser();
  const db = getDb();

  const projectId = String(formData.get("projectId") ?? "");
  const includePhotos = formData.get("includePhotos") === "on";
  const clientMode = formData.get("clientMode") === "on";

  const project = await db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) return { error: "Project tidak ditemukan" };

  const facts = await loadFacts(db, projectId);
  if (!canExportPdf(session.user, facts)) {
    return { error: "Kamu tidak berhak mengekspor project ini" };
  }

  const from = String(formData.get("from") ?? project.startDate);
  const to = String(formData.get("to") ?? project.endDate);

  const dates = dateRange(from, to);
  if (dates.length === 0) return { error: "Rentang tanggal tidak valid" };
  if (dates.length > MAX_RECAP_DAYS) {
    return { error: `Rekap maksimal ${MAX_RECAP_DAYS} hari per PDF. Pilih rentang lebih kecil.` };
  }

  const jar = await headers();
  const origin = pdfOrigin(jar);
  const cookie = jar.get("cookie") ?? "";
  const qs = new URLSearchParams({
    from,
    to,
    photos: includePhotos ? "1" : "0",
    client: clientMode ? "1" : "0",
  });

  const url = `${origin}/print/project/${projectId}?${qs.toString()}`;

  try {
    const pdf = await renderPdfWithCookie(url, cookie);
    return {
      ok: true,
      filename: `rekap-${project.code}-${from}_${to}.pdf`,
      dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}`,
    };
  } catch (err) {
    return { error: pdfErrorMessage(err) };
  }
}

function pdfErrorMessage(err: unknown): string {
  if (err instanceof PdfTimeoutError) return err.message;
  console.error("[pdf export]", err);
  return err instanceof Error ? err.message : "Gagal membuat PDF";
}

/**
 * Chromium needs the caller's cookie to load the protected print route.
 * `renderPdf` in render.ts is cookie-agnostic, so we inject it here via a
 * wrapper that adds the Cookie header to every request in the context.
 */
async function renderPdfWithCookie(url: string, cookie: string): Promise<Buffer> {
  return renderPdf(url, { cookie });
}
