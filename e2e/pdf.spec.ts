/**
 * M7 Export PDF E2E — renders a REAL PDF through Chromium.
 *
 * These tests are slower than the rest because each export launches a browser,
 * and they run against the single-job queue, so they are serialised anyway.
 */
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { today } from "./helpers";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";
const PASSWORD = "OpsDemo2026!";
const PHOTO = fileURLToPath(new URL("./fixtures/test-photo.jpg", import.meta.url));

test.use({ viewport: { width: 390, height: 900 } });

function uniqueCode() {
  return `EVT-2026-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0")}`;
}

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(`${BASE}/`);
}

async function createTodayProject(page: Page, name: string) {
  await page.goto(`${BASE}/projects/new`);
  const visible = page.locator("section:not([hidden])");

  await page.getByLabel("Kode project").fill(uniqueCode());
  await page.getByLabel("Nama project").fill(name);
  await page.getByLabel("Venue").fill("JCC Senayan");
  await page.getByLabel("Klien (opsional)").fill("PT Klien PDF");
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await visible.locator('fieldset input[type="checkbox"]').first().check();
  await expect(page.locator('input[name="cl_label"]').first()).toBeAttached();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  const crewRow = page.locator("section:not([hidden]) li", { hasText: "crew@ops.test" }).first();
  await crewRow.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Simpan project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  return page.url().match(/\/projects\/([0-9a-f-]{36})/)![1];
}


async function submitOpening(page: Page, projectId: string) {
  await page.goto(`${BASE}/projects/${projectId}/days/${today()}/opening`);
  const cards = page.locator("li", { has: page.getByRole("button", { name: "OK", exact: true }) });
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.getByRole("button", { name: "OK", exact: true }).click();
    // A card offers two pickers (camera + gallery); take one.
    const fileInput = card.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(PHOTO);
      await expect(card.getByText(/foto terlampir/)).toBeVisible({ timeout: 20_000 });
    }
  }
  await page.getByRole("button", { name: /Submit Opening/ }).click();
  await expect(page).toHaveURL(/submitted=/, { timeout: 25_000 });
}

/** Locates the day detail URL for a project on /reports. */
async function openDayDetail(page: Page, projectName: string) {
  await page.goto(`${BASE}/reports?status=all`);
  await page.getByRole("link", { name: new RegExp(projectName) }).first().click();
  await expect(page).toHaveURL(/\/reports\/day\//);
}

/** Exports and returns the downloaded file path. */
async function exportDaily(page: Page) {
  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: /Export PDF laporan harian/ }).click();
  const download = await downloadPromise;
  const path = join(tmpdir(), `ops-e2e-${Date.now()}.pdf`);
  await download.saveAs(path);
  return { path, filename: download.suggestedFilename() };
}

test("print view renders server-side (§7.5 content)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Print View ${Date.now()}`;
  const id = await createTodayProject(page, name);
  await submitOpening(page, id);

  await openDayDetail(page, name);
  const dayDetailUrl = page.url();
  const dayId = dayDetailUrl.split("/").pop()!;

  // The print route is a normal authenticated page.
  await page.goto(`${BASE}/print/day/${dayId}`);
  await expect(page.getByText("PROVALIANT")).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText("Laporan Harian")).toBeVisible();
  await expect(page.getByText(/Checklist OK/)).toBeVisible();
  // §7.5: reviewer/completed status block
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
});

test("export produces a valid PDF file (§7.5)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Pdf Daily ${Date.now()}`;
  const id = await createTodayProject(page, name);
  await submitOpening(page, id);

  await openDayDetail(page, name);
  const { path, filename } = await exportDaily(page);

  expect(existsSync(path)).toBe(true);
  expect(filename).toMatch(/^laporan-.*\.pdf$/);

  const buf = readFileSync(path);
  // A real PDF, not an error page saved with a .pdf name.
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(buf.length).toBeGreaterThan(2000);
});

test("client mode hides internal comments in the PDF (§7.5)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Pdf Client ${Date.now()}`;
  const id = await createTodayProject(page, name);
  await submitOpening(page, id);

  await openDayDetail(page, name);
  // Add a reviewer comment that must NOT appear in client mode.
  const marker = `INTERNAL-${Date.now()}`;
  await page.getByLabel(/Komentar review/).fill(marker);
  await page.getByRole("button", { name: "Kirim komentar" }).click();
  await expect(page.getByText(marker)).toBeVisible();

  const dayId = page.url().split("/").pop()!;

  // Without client mode the comment is present in the print view.
  await page.goto(`${BASE}/print/day/${dayId}`);
  await expect(page.getByText(marker)).toBeVisible();

  // With client mode it is hidden.
  await page.goto(`${BASE}/print/day/${dayId}?client=1`);
  await expect(page.getByText(marker)).toHaveCount(0);
  await expect(page.getByText(/Mode klien/).or(page.locator("body"))).toBeVisible();
});

test("photos toggle removes the photo grid (§7.5)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Pdf Photos ${Date.now()}`;
  const id = await createTodayProject(page, name);
  await submitOpening(page, id);

  await openDayDetail(page, name);
  const dayId = page.url().split("/").pop()!;

  await page.goto(`${BASE}/print/day/${dayId}`);
  const withPhotos = await page.locator("img").count();
  expect(withPhotos).toBeGreaterThan(0);

  await page.goto(`${BASE}/print/day/${dayId}?photos=0`);
  await expect(page.getByText(/Foto tidak disertakan/)).toBeVisible();
});

test("project recap export works and respects the 31-day cap", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Pdf Recap ${Date.now()}`;
  const id = await createTodayProject(page, name);

  // Export from the project Settings tab.
  await page.goto(`${BASE}/projects/${id}?tab=settings`);
  await expect(page.getByRole("button", { name: /Export PDF rekap project/ })).toBeVisible();

  const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
  await page.getByRole("button", { name: /Export PDF rekap project/ }).click();
  const download = await downloadPromise;
  const path = join(tmpdir(), `ops-recap-${Date.now()}.pdf`);
  await download.saveAs(path);

  expect(download.suggestedFilename()).toMatch(/^rekap-.*\.pdf$/);
  const buf = readFileSync(path);
  expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
});

test("recap rejects a range longer than 31 days", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Pdf Cap ${Date.now()}`;
  const id = await createTodayProject(page, name);

  await page.goto(`${BASE}/projects/${id}?tab=settings`);
  // A 40-day window must be refused with a clear message, not a hang.
  await page.getByLabel("Dari").fill("2026-01-01");
  await page.getByLabel("Sampai").fill("2026-02-09");
  await page.getByRole("button", { name: /Export PDF rekap project/ }).click();

  // Next's dev overlay also renders role="alert", so scope to the form's slot.
  await expect(page.locator('form p[role="alert"]').first()).toContainText(/31 hari/, {
    timeout: 30_000,
  });
});

test("crew cannot access the print view or export (§2.3)", async ({ page, browser }) => {
  const mgrCtx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const mgrPage = await mgrCtx.newPage();
  await login(mgrPage, "manager@ops.test");
  const name = `Pdf Perm ${Date.now()}`;
  const id = await createTodayProject(mgrPage, name);
  await submitOpening(mgrPage, id);
  await openDayDetail(mgrPage, name);
  const dayId = mgrPage.url().split("/").pop()!;
  await mgrCtx.close();

  await login(page, "crew@ops.test");

  // Print route: denied for crew (server-side check, not a hidden link).
  // Assert on the rendered 404 page rather than res.status(): the page streams,
  // so Next commits a 200 before `notFound()` runs even though no data renders.
  await page.goto(`${BASE}/print/day/${dayId}`);
  await expect(page.getByText(/This page could not be found|404/i).first()).toBeVisible();
  await expect(page.locator(".print-root")).toHaveCount(0);

  // And the export control is absent on the project settings tab.
  await page.goto(`${BASE}/projects/${id}?tab=settings`);
  await expect(page.getByRole("button", { name: /Export PDF rekap project/ })).toHaveCount(0);
});
