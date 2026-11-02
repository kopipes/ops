/**
 * M1 smoke test: real browser login against a running dev server.
 * Run with: npx playwright test (server must be on :3111)
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3111";

test.use({ viewport: { width: 390, height: 844 } }); // mobile (§9.1, §9.4)

test("login page renders and rejects a bad password", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await expect(page.getByRole("heading", { name: "Ops" })).toBeVisible();

  await page.getByLabel("Email").fill("crew@ops.test");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Masuk" }).click();

  await expect(page.getByText("Email atau password salah.")).toBeVisible();
});

test("valid login reaches the home page with the bottom tab bar", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill("crew@ops.test");
  await page.getByLabel("Password").fill("OpsDemo2026!");
  await page.getByRole("button", { name: "Masuk" }).click();

  await expect(page).toHaveURL(`${BASE}/`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Crew Lapangan");

  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  await expect(nav).toBeVisible();
  // §12: crew do not get the Report tab.
  await expect(nav.getByRole("link", { name: "Hari Ini" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Report" })).toHaveCount(0);
});

test("unauthenticated deep link redirects to login", async ({ page }) => {
  await page.goto(`${BASE}/projects`);
  await expect(page).toHaveURL(/\/login$/);
});

test("manager sees the Report tab (§12)", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill("manager@ops.test");
  await page.getByLabel("Password").fill("OpsDemo2026!");
  await page.getByRole("button", { name: "Masuk" }).click();

  await expect(page).toHaveURL(`${BASE}/`);
  const nav = page.getByRole("navigation", { name: "Navigasi utama" });
  await expect(nav.getByRole("link", { name: "Report" })).toBeVisible();
});

test("logout returns to login", async ({ page }) => {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill("crew@ops.test");
  await page.getByLabel("Password").fill("OpsDemo2026!");
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(`${BASE}/`);

  await page.goto(`${BASE}/me`);
  await page.getByRole("button", { name: "Keluar" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto(`${BASE}/`);
  await expect(page).toHaveURL(/\/login$/);
});

test("PWA manifest is named Ops (§9.4)", async ({ request }) => {
  const res = await request.get(`${BASE}/manifest.webmanifest`);
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest.name).toContain("Ops");
  expect(manifest.short_name).toBe("Ops");
  expect(manifest.display).toBe("standalone");
});
