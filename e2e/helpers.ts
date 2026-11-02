/**
 * Shared E2E helpers.
 *
 * `today()` must match how the APP decides "today": the project timezone, not
 * the test runner's. `new Date().toISOString()` is UTC, so between 17:00 and
 * 24:00 UTC (00:00–07:00 WIB) it returns the previous day and every test that
 * navigates to /days/<date>/... fails with "tidak termasuk dalam rentang
 * project". The project wizard defaults to Asia/Jakarta, so use that.
 */
import type { Page } from "@playwright/test";

export const PROJECT_TZ = "Asia/Jakarta";

/** YYYY-MM-DD for "now" in the project timezone. */
export function today(timeZone: string = PROJECT_TZ): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Waits until React has hydrated the page.
 *
 * Server-rendered HTML shows up before React attaches, so a `click()` issued
 * too early hits an inert element and silently does nothing (the handler never
 * runs, nothing errors, and the next assertion just times out). Poll for one of
 * React's internal fiber keys on a client component's DOM node.
 */
export async function waitForHydration(page: Page, selector: string, timeout = 20_000): Promise<void> {
  await page.locator(selector).first().waitFor({ state: "attached" });
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      return Object.keys(el).some((k) => k.startsWith("__reactFiber$") || k.startsWith("__reactProps$"));
    },
    selector,
    { timeout },
  );
}
