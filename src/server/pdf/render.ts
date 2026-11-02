/**
 * PDF rendering via headless Chromium (PRD §7.5).
 *
 * Resource discipline is the whole point of this module. The target VPS is
 * 2 vCPU / 4 GB RAM where Chromium must also serve PDF export, so:
 *
 * - **Exactly one job at a time** per instance. Extra requests WAIT in a queue
 *   (the UI shows "menyiapkan…") rather than erroring.
 * - **120 s timeout** per job, so a broken page cannot hang the box forever.
 * - **A fresh browser per job**, closed in `finally` even on timeout — a leaked
 *   Chromium would exhaust RAM within a few exports.
 * - `--no-sandbox` and `--disable-dev-shm-usage` because containers usually give
 *   /dev/shm only 64 MB, which crashes Chromium mid-render.
 */
import { chromium, type Browser } from "playwright-core";

export const PDF_TIMEOUT_MS = 120_000;
export const MAX_DAILY_DAYS = 1;
export const MAX_RECAP_DAYS = 31;

export class PdfBusyError extends Error {
  constructor(message = "Server sedang membuat PDF lain. Coba lagi sebentar.") {
    super(message);
    this.name = "PdfBusyError";
  }
}

export class PdfTimeoutError extends Error {
  constructor() {
    super("Pembuatan PDF melebihi batas waktu. Coba kurangi jumlah hari atau matikan opsi foto.");
    this.name = "PdfTimeoutError";
  }
}

// ---------------------------------------------------------------------------
// Single-job semaphore (§7.5)
// ---------------------------------------------------------------------------

/**
 * FIFO queue with concurrency 1. Kept in module scope: it is per-process, which
 * matches the single-instance deployment in §10. If the app ever runs multiple
 * instances, this must move to a shared lock (and the comment above is the
 * reminder that the guarantee is then lost).
 */
let running = false;
const waiters: Array<() => void> = [];

/** Number of jobs waiting (used by the UI to show queue state). */
export const queuedJobs = () => waiters.length;
export const isRendering = () => running;

async function acquire(): Promise<void> {
  if (!running) {
    running = true;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  running = true;
}

function release(): void {
  running = false;
  const next = waiters.shift();
  if (next) next();
}

/** Test hook: force-reset the semaphore between tests. */
export function _resetPdfQueue(): void {
  running = false;
  waiters.length = 0;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const CHROMIUM_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  // Extra headroom for a 4 GB box: no background services we don't need.
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-extensions",
  "--disable-sync",
  "--no-first-run",
  "--mute-audio",
];

export interface RenderOptions {
  /**
   * The CALLER's cookie header, forwarded to the print route.
   *
   * The /print pages are ordinary authenticated routes, so Chromium must present
   * the same session. This keeps authorization identical to the action that
   * requested the export — we never widen access just to render a PDF.
   */
  cookie?: string;
}

/**
 * Renders an authenticated, internal print URL to a PDF buffer.
 *
 * `printUrl` must be absolute and must point at our own `/print/*` routes, which
 * re-check the session — the renderer never receives a public URL.
 */
export async function renderPdf(printUrl: string, options: RenderOptions = {}): Promise<Buffer> {
  await acquire();

  let browser: Browser | null = null;
  try {
    const job = (async () => {
      browser = await chromium.launch({ args: CHROMIUM_ARGS });

      const context = await browser.newContext({
        // Print geometry: A4 portrait with a sensible margin.
        viewport: { width: 1200, height: 1600 },
        deviceScaleFactor: 1,
        // Same session as the user who asked for the export.
        ...(options.cookie ? { extraHTTPHeaders: { cookie: options.cookie } } : {}),
      });

      try {
        const page = await context.newPage();
        const response = await page.goto(printUrl, {
          waitUntil: "networkidle",
          timeout: PDF_TIMEOUT_MS,
        });

        if (!response || !response.ok()) {
          throw new Error(`Halaman print gagal dimuat (${response?.status() ?? "no response"})`);
        }

        // Wait for images to settle so photos are not dropped from the PDF.
        await page
          .evaluate(async () => {
            await Promise.all(
              Array.from(document.images)
                .filter((img) => !img.complete)
                .map(
                  (img) =>
                    new Promise<void>((resolve) => {
                      img.onload = () => resolve();
                      img.onerror = () => resolve();
                    }),
                ),
            );
          })
          .catch(() => {
            // A broken image must not fail the whole export.
          });

        await page.emulateMedia({ media: "print" });

        return await page.pdf({
          format: "A4",
          printBackground: true,
          margin: { top: "12mm", bottom: "14mm", left: "10mm", right: "10mm" },
          displayHeaderFooter: true,
          headerTemplate: `<div style="font-size:8px;width:100%;padding:0 10mm;color:#94a3b8;">Ops</div>`,
          footerTemplate: `<div style="font-size:8px;width:100%;padding:0 10mm;color:#94a3b8;text-align:right;">
            Halaman <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>`,
        });
      } finally {
        // Dispose the context so its renderer process is reclaimed.
        await context.close().catch(() => {});
      }
    })();

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PdfTimeoutError()), PDF_TIMEOUT_MS);
    });

    try {
      return await Promise.race([job, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } finally {
    if (browser) {
      // Closing is essential: without it the Chromium process outlives the job.
      await (browser as Browser).close().catch(() => {});
    }
    release();
  }
}

/** §7.5 content caps. */
export function assertRangeAllowed(dayCount: number): void {
  if (dayCount < 1) throw new Error("Rentang tanggal tidak valid");
  if (dayCount > MAX_RECAP_DAYS) {
    throw new Error(
      `Rekap maksimal ${MAX_RECAP_DAYS} hari per PDF. Pilih rentang yang lebih kecil.`,
    );
  }
}
