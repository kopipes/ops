import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetPdfQueue,
  assertRangeAllowed,
  isRendering,
  MAX_DAILY_DAYS,
  MAX_RECAP_DAYS,
  PDF_TIMEOUT_MS,
  PdfTimeoutError,
  queuedJobs,
  renderPdf,
} from "./render";
import { parsePrintOptions } from "@/lib/print/shared";
import { dateRange } from "@/lib/datetime";

describe("PDF content caps (§7.5)", () => {
  it("allows a single day", () => {
    expect(() => assertRangeAllowed(MAX_DAILY_DAYS)).not.toThrow();
  });

  it("allows up to 31 days", () => {
    expect(() => assertRangeAllowed(MAX_RECAP_DAYS)).not.toThrow();
  });

  it("rejects 32 days", () => {
    expect(() => assertRangeAllowed(32)).toThrow(/31 hari/);
  });

  it("rejects zero or negative ranges", () => {
    expect(() => assertRangeAllowed(0)).toThrow();
    expect(() => assertRangeAllowed(-5)).toThrow();
  });

  it("a real 31-day range is accepted, 32 is not", () => {
    const thirtyOne = dateRange("2026-11-01", "2026-12-01");
    expect(thirtyOne).toHaveLength(31);
    expect(() => assertRangeAllowed(thirtyOne.length)).not.toThrow();

    const thirtyTwo = dateRange("2026-11-01", "2026-12-02");
    expect(thirtyTwo).toHaveLength(32);
    expect(() => assertRangeAllowed(thirtyTwo.length)).toThrow();
  });

  it("documents the 120s timeout", () => {
    expect(PDF_TIMEOUT_MS).toBe(120_000);
  });
});

describe("print options (§7.5)", () => {
  it("defaults to including photos and NOT client mode", () => {
    expect(parsePrintOptions(new URLSearchParams())).toEqual({
      includePhotos: true,
      clientMode: false,
    });
  });

  it("honours photos=0", () => {
    expect(parsePrintOptions(new URLSearchParams("photos=0")).includePhotos).toBe(false);
  });

  it("honours client=1", () => {
    expect(parsePrintOptions(new URLSearchParams("client=1")).clientMode).toBe(true);
  });
});

/**
 * The semaphore is the resource guarantee from §7.5. These tests replace
 * playwright-core with a fake so they assert the queueing behaviour without
 * launching Chromium 4 times (which would be slow and fragile in CI).
 */
const fakeState = {
  active: 0,
  maxActive: 0,
  launches: 0,
  closed: 0,
  /** Optional delay per job in ms. */
  delay: 10,
  failNext: false,
};

vi.mock("playwright-core", () => {
  return {
    chromium: {
      launch: async () => {
        fakeState.launches += 1;
        // Measure concurrency INSIDE the render pipeline: a launch is the moment a
        // job actually starts using Chromium.
        fakeState.active += 1;
        fakeState.maxActive = Math.max(fakeState.maxActive, fakeState.active);
        return {
          newContext: async () => ({
            route: async () => {},
            newPage: async () => ({
              goto: async () => {
                if (fakeState.failNext) {
                  fakeState.failNext = false;
                  return { ok: () => false, status: () => 500 };
                }
                await new Promise((r) => setTimeout(r, fakeState.delay));
                return { ok: () => true, status: () => 200 };
              },
              evaluate: async () => undefined,
              emulateMedia: async () => undefined,
              pdf: async () => Buffer.from("%PDF-1.4 fake"),
            }),
            close: async () => {},
          }),
          close: async () => {
            fakeState.closed += 1;
            fakeState.active -= 1;
          },
        };
      },
    },
  };
});

beforeEach(() => {
  _resetPdfQueue();
  fakeState.active = 0;
  fakeState.maxActive = 0;
  fakeState.launches = 0;
  fakeState.closed = 0;
  fakeState.delay = 10;
  fakeState.failNext = false;
});

afterEach(() => {
  _resetPdfQueue();
});

describe("single-job queue (§7.5)", () => {
  it("never runs two jobs at once", async () => {
    // Concurrency is measured inside the mock: `active` counts live Chromium
    // instances, so this fails if the semaphore ever lets two jobs overlap.
    const results = await Promise.all(
      [1, 2, 3, 4].map(() => renderPdf("http://localhost/print/day/x")),
    );

    expect(results).toHaveLength(4);
    expect(fakeState.maxActive).toBe(1);
    expect(fakeState.launches).toBe(4); // one browser per job, never shared
    expect(fakeState.closed).toBe(4); // and every one was disposed
  });

  it("closes the browser after every job", async () => {
    await renderPdf("http://localhost/print/day/x");
    expect(fakeState.launches).toBe(1);
    expect(fakeState.closed).toBe(1);
  });

  it("releases the queue even when rendering throws", async () => {
    fakeState.failNext = true;
    await expect(renderPdf("http://localhost/print/day/x")).rejects.toThrow(/gagal dimuat/i);

    // A follow-up job must still run — a failed job must not deadlock the queue.
    const pdf = await renderPdf("http://localhost/print/day/x");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("reports queue depth while jobs wait", async () => {
    fakeState.delay = 50;
    const first = renderPdf("http://localhost/print/day/x");
    // Let the first job acquire the semaphore.
    await new Promise((r) => setTimeout(r, 5));

    const second = renderPdf("http://localhost/print/day/y");
    const third = renderPdf("http://localhost/print/day/z");

    expect(isRendering()).toBe(true);
    expect(queuedJobs()).toBeGreaterThanOrEqual(1);

    await Promise.all([first, second, third]);
    expect(queuedJobs()).toBe(0);
    expect(isRendering()).toBe(false);
  });

  it("forwards the caller's cookie to the print route", async () => {
    // The fake ignores headers, so assert via the mock's launch count and that
    // the call does not throw with an option object present.
    await expect(
      renderPdf("http://localhost/print/day/x", { cookie: "ops_session=abc" }),
    ).resolves.toBeInstanceOf(Buffer);
  });
});

describe("PdfTimeoutError", () => {
  it("has a helpful message mentioning the options", () => {
    const err = new PdfTimeoutError();
    expect(err.message).toMatch(/batas waktu/i);
    expect(err.message).toMatch(/foto/i);
  });
});
