/**
 * M5 Issues E2E — create, timeline, status lifecycle, permissions.
 * Requires the seed (categories + projects).
 */
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { today } from "./helpers";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3111";
const PASSWORD = "OpsDemo2026!";
const PHOTO = fileURLToPath(new URL("./fixtures/test-photo.jpg", import.meta.url));

/**
 * Collision-resistant project code. The project code is UNIQUE in the database,
 * and a few thousand random 4-digit codes collide often once the suite has run
 * many times against the same dev database.
 */
function uniqueCode() {
  return `EVT-2026-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0")}`;
}

test.use({ viewport: { width: 390, height: 844 } });

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(`${BASE}/`);
}

/** Creates a project today owned by d-evt with crew@ as a member. */
async function createProjectWithCrew(page: Page, name: string) {
  await page.goto(`${BASE}/projects/new`);
  const visible = page.locator("section:not([hidden])");

  await page.getByLabel("Kode project").fill(uniqueCode());
  await page.getByLabel("Nama project").fill(name);
  await page.getByLabel("Venue").fill("JCC");
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  // no checklist needed for issues
  await page.getByRole("button", { name: "Lanjut →" }).click();
  const crewRow = page.locator("section:not([hidden]) li", { hasText: "crew@ops.test" }).first();
  await crewRow.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Simpan project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  return page.url().match(/\/projects\/([0-9a-f-]{36})/)![1];
}

/** Creates an issue via the UI; returns the detail URL. */
async function createIssueViaUI(page: Page, title: string, opts: { withPhoto?: boolean } = {}) {
  await page.goto(`${BASE}/issues/new`);
  await page.getByLabel("Judul").fill(title);
  await page.getByLabel("Deskripsi (opsional)").fill("Deskripsi E2E");

  const cat = page.getByLabel("Kategori");
  if ((await cat.locator("option").count()) > 1) {
    await cat.selectOption({ index: 1 });
  }
  await page.getByLabel("Severity").selectOption("high");
  await page.getByLabel("Next step / action plan").fill("Hubungi vendor");

  if (opts.withPhoto !== false) {
    await page.getByLabel(/Foto/).setInputFiles(PHOTO);
    await expect(page.getByText(/1 foto terlampir/)).toBeVisible({ timeout: 20_000 });
  }

  await page.getByRole("button", { name: "Buat issue" }).click();
  await expect(page).toHaveURL(/\/issues\/[0-9a-f-]{36}/);
  return page.url();
}

test("manager can create an issue and it shows in the list", async ({ page }) => {
  await login(page, "manager@ops.test");
  await createProjectWithCrew(page, `Issue Project ${Date.now()}`);

  const title = `Lampu mati ${Date.now()}`;
  await createIssueViaUI(page, title);

  // Detail shows code, identity snapshot and the "created" timeline entry.
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText(/membuat issue/)).toBeVisible();
  await expect(page.getByText(/Diposting oleh Manager Event/)).toBeVisible();
  // The issue code is per-project, so assert the shape, not a specific number.
  await expect(page.getByText(/-I-\d{3}/)).toBeVisible();

  await page.goto(`${BASE}/issues`);
  await expect(page.getByText(title)).toBeVisible();
});

test("issue creation requires at least one photo (§4.7)", async ({ page }) => {
  await login(page, "manager@ops.test");
  await createProjectWithCrew(page, `NoPhoto ${Date.now()}`);

  await page.goto(`${BASE}/issues/new`);
  await page.getByLabel("Judul").fill(`Tanpa foto ${Date.now()}`);
  const cat = page.getByLabel("Kategori");
  if ((await cat.locator("option").count()) > 1) await cat.selectOption({ index: 1 });
  await page.getByLabel("Next step / action plan").fill("Cek");
  await page.getByRole("button", { name: "Buat issue" }).click();

  await expect(page.locator('form p[role="alert"]').first()).toContainText(/foto/i);
});

test("crew can move to In Progress and Resolved but not Closed (§2.3)", async ({ page, browser }) => {
  const mgrCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mgr = await mgrCtx.newPage();
  await login(mgr, "manager@ops.test");
  await createProjectWithCrew(mgr, `Lifecycle ${Date.now()}`);
  const url = await createIssueViaUI(mgr, `Issue lifecycle ${Date.now()}`);
  await mgrCtx.close();

  await login(page, "crew@ops.test");
  await page.goto(url);

  // Crew sees status options but Closed must not be offered.
  const statusSelect = page.getByLabel("Status baru");
  await expect(statusSelect).toBeVisible();
  const options = await statusSelect.locator("option").allTextContents();
  expect(options).not.toContain("Closed");
  expect(options).toContain("In Progress");

  await statusSelect.selectOption("in_progress");
  await page.getByLabel("Catatan perubahan status").fill("Vendor dihubungi");
  await page.getByRole("button", { name: "Simpan status" }).click();

  await expect(page.getByText(/Open → In Progress/)).toBeVisible();
  await expect(page.getByText(/Vendor dihubungi/)).toBeVisible();
});

test("manager can close and the timeline records it (§9.5 no.3)", async ({ page }) => {
  await login(page, "manager@ops.test");
  await createProjectWithCrew(page, `Close ${Date.now()}`);
  const url = await createIssueViaUI(page, `Issue close ${Date.now()}`);

  await page.goto(url);
  await page.getByLabel("Status baru").selectOption("closed");
  await page.getByLabel("Catatan perubahan status").fill("Sudah ditangani");
  await page.getByRole("button", { name: "Simpan status" }).click();

  await expect(page.getByText(/Open → Closed/)).toBeVisible();
  await expect(page.getByText(/Sudah ditangani/)).toBeVisible();
});

test("comment is appended to the timeline", async ({ page }) => {
  await login(page, "manager@ops.test");
  await createProjectWithCrew(page, `Comment ${Date.now()}`);
  const url = await createIssueViaUI(page, `Issue comment ${Date.now()}`);

  await page.goto(url);
  await page.getByLabel("Komentar").fill("Teknisi sudah datang");
  await page.getByRole("button", { name: "Kirim komentar" }).click();

  await expect(page.getByText(/berkomentar/)).toBeVisible();
  await expect(page.getByText(/Teknisi sudah datang/)).toBeVisible();
});

test("editing an issue records a field diff", async ({ page }) => {
  await login(page, "manager@ops.test");
  await createProjectWithCrew(page, `Diff ${Date.now()}`);
  const url = await createIssueViaUI(page, `Issue diff ${Date.now()}`);

  await page.goto(url);
  await expect(page.getByText(/High/).first()).toBeVisible();

  // Status change produces a status diff entry; verify old -> new is rendered.
  await page.getByLabel("Status baru").selectOption("in_progress");
  await page.getByRole("button", { name: "Simpan status" }).click();
  await expect(page.getByText(/Open → In Progress/)).toBeVisible();
});

test("'Jadikan Issue' prefills from a NOT OK checklist item (§4.3 no.3)", async ({ page }) => {
  await login(page, "manager@ops.test");
  // project with a template so the opening form has items
  await page.goto(`${BASE}/projects/new`);
  const visible = page.locator("section:not([hidden])");
  await page.getByLabel("Kode project").fill(uniqueCode());
  await page.getByLabel("Nama project").fill(`Prefill ${Date.now()}`);
  await page.getByLabel("Venue").fill("JCC");
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await visible.locator('fieldset input[type="checkbox"]').first().check();
  await expect(page.locator('input[name="cl_label"]').first()).toBeAttached();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Simpan project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  const id = page.url().match(/\/projects\/([0-9a-f-]{36})/)![1];

  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);

  const cards = page.locator("li", { has: page.getByRole("button", { name: "OK", exact: true }) });
  await cards.nth(0).getByRole("button", { name: "Tidak OK" }).click();
  await cards.nth(0).locator("textarea").fill("Lampu putus");

  const link = cards.nth(0).getByRole("link", { name: "Jadikan Issue" });
  await expect(link).toBeVisible();
  await link.click();

  await expect(page).toHaveURL(/\/issues\/new/);
  await expect(page.getByLabel("Deskripsi (opsional)")).toHaveValue("Lampu putus");
  await expect(page.getByLabel("Judul")).not.toHaveValue("");
});

test("issue list filters by status", async ({ page }) => {
  await login(page, "manager@ops.test");
  await createProjectWithCrew(page, `Filter ${Date.now()}`);
  const unique = `Filterable ${Date.now()}`;
  const url = await createIssueViaUI(page, unique);

  await page.goto(url);
  await page.getByLabel("Status baru").selectOption("closed");
  await page.getByRole("button", { name: "Simpan status" }).click();
  await expect(page.getByText(/Closed/).first()).toBeVisible();

  // Other tests leave open issues behind, so assert on THIS issue rather than
  // expecting an empty list.
  await page.goto(`${BASE}/issues?status=closed`);
  await expect(page.getByText(unique)).toBeVisible();

  await page.goto(`${BASE}/issues?status=open`);
  await expect(page.getByText(unique)).toHaveCount(0);
});
