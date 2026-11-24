/**
 * M2 Master Data E2E — real browser, mobile viewport.
 * Assumes the seed has been run (pnpm db:seed).
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";
const PASSWORD = "OpsDemo2026!";

test.use({ viewport: { width: 390, height: 844 } });

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(`${BASE}/`);
}

test("Manager sees templates for their division via the old checklist link", async ({ page }) => {
  await login(page, "manager@ops.test");
  await page.goto(`${BASE}/master/checklist-items`);
  await expect(page).toHaveURL(`${BASE}/master/templates`);
  await expect(page.getByRole("heading", { name: "Template Divisi", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Event Production", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Standar Event Harian/ })).toBeVisible();
  await page.getByRole("link", { name: "Upload Excel" }).click();
  await expect(page.getByText("Event Production", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Divisi", exact: true })).toHaveCount(0);
});

test("Crew cannot open templates or download the workbook", async ({ page }) => {
  await login(page, "crew@ops.test");
  await page.goto(`${BASE}/master/templates`);
  await expect(page).toHaveURL(`${BASE}/`);
  expect((await page.request.get(`${BASE}/api/division-templates/workbook`)).status()).toBe(403);
});

test("admin manages issue categories", async ({ page }) => {
  await login(page, "admin@ops.test");
  await page.goto(`${BASE}/master/issue-categories`);

  await expect(page.getByRole("heading", { name: "Kategori Issue" })).toBeVisible();
  await page.getByLabel("Nama").fill(`Teknis E2E ${Date.now()}`);
  await page.getByRole("button", { name: "Tambah kategori" }).click();

  await expect(page.getByText(/Teknis E2E/).first()).toBeVisible();
});

test("manager cannot open issue categories (§12 admin-only)", async ({ page }) => {
  await login(page, "manager@ops.test");
  await page.goto(`${BASE}/master/issue-categories`);
  await expect(page).toHaveURL(`${BASE}/`);
});
