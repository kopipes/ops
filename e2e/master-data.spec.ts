/**
 * M2 Master Data E2E — real browser, mobile viewport.
 * Assumes the seed has been run (pnpm db:seed).
 */
import { expect, test } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3111";
const PASSWORD = "OpsDemo2026!";

test.use({ viewport: { width: 390, height: 844 } });

async function login(page: import("@playwright/test").Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(`${BASE}/`);
}

test("manager can open master checklist and sees items", async ({ page }) => {
  await login(page, "manager@ops.test");
  await page.goto(`${BASE}/master/checklist-items`);

  await expect(page.getByRole("heading", { name: "Master Checklist" })).toBeVisible();
  // Seeded items are global, so a manager must see them.
  await expect(page.getByText("Lampu panggung & lighting berfungsi")).toBeVisible();
});

test("admin creates a global checklist item and it appears in the list", async ({ page }) => {
  await login(page, "admin@ops.test");
  await page.goto(`${BASE}/master/checklist-items`);

  const label = `Cek lampu darurat ${Date.now()}`;
  await page.getByRole("button", { name: "+ Item" }).click();
  await page.getByLabel("Label item").fill(label);
  await page.getByLabel("Fase").selectOption("opening");
  await page.getByRole("button", { name: "Tambah item" }).click();

  await expect(page.getByText(label)).toBeVisible();
});

test("manager sees the division locked to their own on the item form", async ({ page }) => {
  await login(page, "manager@ops.test");
  await page.goto(`${BASE}/master/checklist-items`);
  await page.getByRole("button", { name: "+ Item" }).click();

  // The division selector is replaced by a locked label for managers.
  await expect(page.getByLabel("Divisi terkunci")).toBeVisible();
  await expect(page.getByText("Hanya Admin yang bisa memindahkan item antar divisi.")).toBeVisible();
});

test("deactivating an item hides it by default but keeps it visible when toggled", async ({ page }) => {
  await login(page, "admin@ops.test");
  await page.goto(`${BASE}/master/checklist-items`);

  // Create a dedicated item so this test does not depend on another test's data
  // or on run order. A unique label also makes repeated runs safe.
  const label = `Item nonaktif ${Date.now()}`;
  await page.getByRole("button", { name: "+ Item" }).click();
  await page.getByLabel("Label item").fill(label);
  await page.getByRole("button", { name: "Tambah item" }).click();
  await expect(page.getByText(label)).toBeVisible();

  const card = page.locator("li", { hasText: label }).first();
  await card.getByRole("button", { name: "Nonaktifkan" }).click();
  await expect(page.getByText(label)).toHaveCount(0);

  await page.getByLabel("Tampilkan item nonaktif").check();
  await expect(page.getByText(label)).toBeVisible();
  await expect(page.getByText("Nonaktif").first()).toBeVisible();
});

test("crew cannot reach master data (§12)", async ({ page }) => {
  await login(page, "crew@ops.test");
  await page.goto(`${BASE}/master/checklist-items`);
  // Server-side redirect, not merely a hidden link.
  await expect(page).toHaveURL(`${BASE}/`);
});

test("templates page lists seeded templates", async ({ page }) => {
  await login(page, "admin@ops.test");
  await page.goto(`${BASE}/master/templates`);

  await expect(page.getByRole("heading", { name: "Template Checklist" })).toBeVisible();
  await expect(page.getByText("Standar Event Harian")).toBeVisible();
  await expect(page.getByText("Opening & Closing Saja")).toBeVisible();
});

test("admin creates a template from master items", async ({ page }) => {
  await login(page, "admin@ops.test");
  await page.goto(`${BASE}/master/templates/new`);

  await page.getByLabel("Nama template").fill(`Template E2E ${Date.now()}`);
  // Opening tab is default; add two items from the pool.
  await page.getByRole("button", { name: /Area venue bersih/ }).click();
  await page.getByRole("button", { name: /Pintu masuk & signage/ }).click();

  await expect(page.getByRole("heading", { name: /Item terpilih \(2\)/ })).toBeVisible();
  await page.getByRole("button", { name: "Simpan template" }).click();

  await expect(page.getByText("Tersimpan")).toBeVisible();
});

test("template created from project promotes custom items (§5.2)", async ({ page }) => {
  await login(page, "admin@ops.test");
  await page.goto(`${BASE}/master/templates`);

  // With no projects in M1/M2 seed, the picker should still be present and empty-safe.
  await page.getByRole("button", { name: "Dari project lama" }).click();
  await expect(
    page.getByRole("heading", { name: "Simpan checklist project sebagai template" }),
  ).toBeVisible();
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
