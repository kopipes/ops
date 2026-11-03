/**
 * Shared pieces for the /print/* views (§7.5 content requirements).
 *
 * These pages are rendered by headless Chromium, not seen by humans directly,
 * but they are still normal authenticated routes so a leaked URL cannot expose
 * data. They use plain inline CSS so the PDF is stable without a CSS pipeline.
 */

import { formatReportTimestamp } from "@/lib/datetime";

export interface PrintOptions {
  /** §7.5: "sertakan foto" (ya/tidak). */
  includePhotos: boolean;
  /** §7.5: "mode klien" — hides internal comments and audit notes. */
  clientMode: boolean;
}

export function parsePrintOptions(searchParams: URLSearchParams): PrintOptions {
  return {
    includePhotos: searchParams.get("photos") !== "0",
    clientMode: searchParams.get("client") === "1",
  };
}

export const printCss = `
  * { box-sizing: border-box; }
  /*
   * The root layout reserves space for the sticky bottom tab bar. Print pages are
   * rendered outside any app chrome, so that padding must be removed or every
   * PDF page gains an empty band at the bottom.
   */
  body { padding-bottom: 0 !important; background: #fff !important; }
  body > div.print-root { margin: 0; max-width: none; padding: 0; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #0f172a;
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
  }
  h1 { font-size: 19px; margin: 0 0 2px 0; }
  h2 { font-size: 13px; margin: 14px 0 6px 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 2px; }
  h3 { font-size: 11px; margin: 10px 0 4px 0; }
  .muted { color: #64748b; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 2px solid #1d4ed8; padding-bottom: 8px; }
  .logo { font-weight: 700; color: #1d4ed8; font-size: 15px; letter-spacing: .5px; }
  .meta { font-size: 10px; color: #475569; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0; }
  .stat { border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 7px; text-align: center; }
  .stat .k { font-size: 9px; color: #64748b; }
  .stat .v { font-size: 14px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; }
  th, td { border: 1px solid #cbd5e1; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; }
  .ok { color: #166534; }
  .warn { color: #9a3412; }
  .bad { color: #991b1b; }
  .pill { display: inline-block; border-radius: 999px; padding: 0 5px; font-size: 9px; }
  .pill-notok { background: #fee2e2; color: #991b1b; }
  .pill-na { background: #e2e8f0; color: #334155; }
  .pill-ok { background: #dcfce7; color: #166534; }
  .notok-row { background: #fef2f2; }
  .photos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
  .photo { border: 1px solid #cbd5e1; border-radius: 3px; overflow: hidden; }
  .photo img { width: 100%; height: 120px; object-fit: cover; display: block; }
  .photo .cap { font-size: 8px; color: #475569; padding: 2px 3px; }
  .block { border: 1px solid #cbd5e1; border-radius: 6px; padding: 7px 9px; margin-bottom: 8px; }
  .day { page-break-inside: avoid; margin-bottom: 16px; }
  .page-break { page-break-before: always; }
  .reviewed { color: #166534; font-weight: 600; }
  .not-reviewed { color: #9a3412; font-weight: 600; }
  ul { margin: 2px 0 0 14px; padding: 0; }
  li { margin: 0 0 1px 0; }
`;

export function phaseLabel(phase: string): string {
  if (phase === "opening") return "Opening";
  if (phase === "monitoring") return "Monitoring";
  if (phase === "closing") return "Closing";
  return phase;
}

export function formatDateTime(ms: number | null, timezone: string): string {
  return formatReportTimestamp(ms, timezone);
}

export function formatTime(ms: number | null, timezone: string): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}
