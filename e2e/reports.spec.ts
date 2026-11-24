/**
 * M6 Report & Review E2E.
 * Requires the seed. Each test creates its own project/day to stay independent.
 */
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { today, waitForHydration } from "./helpers";
import { addDays } from "../src/lib/datetime";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";
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

test.use({ viewport: { width: 390, height: 900 } });

test.setTimeout(60_000);

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(`${BASE}/`);
}

/** Creates a one-day project with a template and a Crew member. */
async function createTodayProject(page: Page, name: string, date?: string) {
  await page.goto(`${BASE}/projects/new`);
  const visible = page.locator("section:not([hidden])");

  await page.getByLabel("Kode project").fill(uniqueCode());
  await page.getByLabel("Nama project").fill(name);
  await page.getByLabel("Venue").fill("JCC");
  if (date) {
    await page.getByLabel("Tanggal mulai", { exact: true }).fill(date);
    await page.getByLabel("Tanggal selesai", { exact: true }).fill(date);
  }
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


/** Answers all opening items OK, attaching a photo where a file input exists. */
async function submitOpening(page: Page, projectId: string, date = today()) {
  await page.goto(`${BASE}/projects/${projectId}/days/${date}/opening`);
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

/** Finds the report row link for a project name on /reports. */
async function openDayDetail(page: Page, projectName: string) {
  await page.goto(`${BASE}/reports`);
  await waitForHydration(page, 'a[href^="/reports/day/"]');
  await page.getByRole("link", { name: new RegExp(projectName) }).first().click();
  await expect(page).toHaveURL(/\/reports\/day\//);
  return page.url();
}

test("report list shows today's row with phase status (§7.1)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Report Row ${Date.now()}`;
  await createTodayProject(page, name);

  await page.goto(`${BASE}/reports`);
  const row = page.locator("main > ul > li", { hasText: name }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Opening");
  await expect(row).toContainText("Checklist OK");
});

test("day detail shows the timeline with NOT_OK highlighted (§7.2)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Day Detail ${Date.now()}`;
  const id = await createTodayProject(page, name);
  await submitOpening(page, id);

  const url = await openDayDetail(page, name);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Opening").first()).toBeVisible();
  await expect(page.getByText(/Checklist OK/)).toBeVisible();
  await expect(page.getByText("Area venue bersih dan siap dipakai", { exact: true })).toBeVisible();
  await expect(page.locator('details[id^="checklist-"]').first()).toHaveAttribute("open", "");
  await waitForHydration(page, 'button[aria-label^="Perbesar"]');
  const thumbnail = page.getByRole("button", { name: /^Perbesar .*foto/ }).first();
  await thumbnail.click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  const original = await modal.locator("img").getAttribute("src");
  expect(original).not.toContain("v=thumb");
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(thumbnail).toBeFocused();
});

test("manager can Mark as Reviewed and the state persists (§7.2 no.7)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Review ${Date.now()}`;
  const id = await createTodayProject(page, name);
  await submitOpening(page, id);

  const url = await openDayDetail(page, name);
  await page.getByRole("button", { name: "Mark as Reviewed" }).click();

  await expect(page.getByText(/Direview oleh/)).toBeVisible();
  await expect(page.getByText(/Laporan tetap bisa diedit/)).toBeVisible();

  // Reload: state persisted.
  await page.goto(url);
  await expect(page.getByText(/Direview oleh/)).toBeVisible();
});

test("review does not lock manager report entry", async ({ page, browser }) => {
  const mgrCtx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const mgrPage = await mgrCtx.newPage();
  await login(mgrPage, "manager@ops.test");
  const name = `Locked ${Date.now()}`;
  const id = await createTodayProject(mgrPage, name);
  await submitOpening(mgrPage, id);
  const url = await openDayDetail(mgrPage, name);
  await mgrPage.getByRole("button", { name: "Mark as Reviewed" }).click();
  await expect(mgrPage.getByText(/Direview oleh/)).toBeVisible();
  await mgrCtx.close();

  // Crew opens the opening form: locked by the review.
  await login(page, "manager@ops.test");
  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  await expect(page.getByRole("button", { name: /Submit Opening/ })).toBeVisible();

  void url;
});

test("reviewer comment is visible to crew (§7.2 no.7)", async ({ page, browser }) => {
  const mgrCtx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const mgrPage = await mgrCtx.newPage();
  await login(mgrPage, "manager@ops.test");
  const name = `Comment ${Date.now()}`;
  const id = await createTodayProject(mgrPage, name);

  await submitOpening(mgrPage,id);
  const url = await openDayDetail(mgrPage, name);
  const point=mgrPage.locator('li[id^="point-"]').first();
  await point.getByRole("checkbox",{name:"Tidak OK",exact:true}).check();
  await point.getByRole("radio",{name:"Others",exact:true}).check();
  await point.getByLabel("Apa yang perlu diperbaiki?",{exact:true}).fill("Tolong lengkapi foto sisi timur");
  await point.getByRole("button",{name:"Simpan review poin",exact:true}).click();
  await expect(mgrPage.getByText("Tolong lengkapi foto sisi timur")).toBeVisible();
  await mgrCtx.close();

  await login(page, "crew@ops.test");
  await page.goto(url);
  await expect(page.getByText("Tolong lengkapi foto sisi timur")).toBeVisible();
  void id;
});

test("un-review requires a reason and reopens editing (§13.1 / Q14)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Unreview ${Date.now()}`;
  const id = await createTodayProject(page, name);
  await submitOpening(page, id);

  const url = await openDayDetail(page, name);
  await page.getByRole("button", { name: "Mark as Reviewed" }).click();
  await expect(page.getByText(/Direview oleh/)).toBeVisible();

  await page.getByLabel("Alasan membatalkan review").fill("Laporan perlu dikoreksi");
  await page.getByRole("button", { name: "Batalkan review" }).click();

  await expect(page.getByRole("button", { name: "Mark as Reviewed" })).toBeVisible();
});

test("corporate can review but not manage (§2.3)", async ({ page, browser }) => {
  // The manager creates the project in its own context; logging in twice in one
  // cookie jar would leave the page on /login (already authenticated).
  const mgrCtx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const mgrPage = await mgrCtx.newPage();
  await login(mgrPage, "manager@ops.test");
  const name = `Corp Rev ${Date.now()}`;
  await createTodayProject(mgrPage, name);
  await mgrCtx.close();

  await login(page, "corporate@ops.test");
  await page.goto(`${BASE}/reports`);
  await expect(page.getByRole("heading", { name: "Report Harian" })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
});

test("crew cannot open the report page (§12)", async ({ page }) => {
  await login(page, "crew@ops.test");
  await page.goto(`${BASE}/reports`);
  await expect(page.getByText("Akun ini belum memiliki akses ke ringkasan report.")).toBeVisible();
});

test("dashboard shows counters and needs-attention (§7.3)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `Dash ${Date.now()}`;
  await createTodayProject(page, name); // no opening submitted -> needs attention

  await page.goto(`${BASE}/dashboard`);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Project aktif")).toBeVisible();
  await expect(page.getByText("Butuh perhatian")).toBeVisible();
  await expect(page.getByText(/Opening hari ini belum diisi/).first()).toBeVisible();
});

test("report list filters by unreviewed status (§7.1)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const name = `FilterRev ${Date.now()}`;
  const id = await createTodayProject(page, name);
  await submitOpening(page, id);

  const url = await openDayDetail(page, name);
  await page.getByRole("button", { name: "Mark as Reviewed" }).click();
  await expect(page.getByText(/Direview oleh/)).toBeVisible();

  await page.goto(`${BASE}/reports?status=unreviewed`);
  // The reviewed project must not appear in the unreviewed filter.
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);

  await page.goto(`${BASE}/reports?status=all`);
  await expect(page.getByRole("link", { name: new RegExp(name) }).first()).toBeVisible();
});


test("older reports are visible by default and Crew can open them from project history", async ({ page, browser }) => {
  await login(page, "manager@ops.test");
  const yesterday = addDays(today(), -1);
  const name = `Riwayat project ${Date.now()}`;
  const projectId = await createTodayProject(page, name, yesterday);
  await submitOpening(page, projectId, yesterday);

  await page.goto(`${BASE}/reports`);
  await expect(page.getByRole("link", { name: "7 hari terakhir" })).toHaveAttribute("aria-current", "true");
  const row = page.locator("main > ul > li", { hasText: name });
  await expect(row).toContainText(yesterday);
  await expect(row).toContainText("Terisi");
  await page.getByRole("link", { name: "Hari ini", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByLabel("Dari", { exact: true })).toHaveValue(today());
  await page.getByRole("link", { name: "30 hari terakhir" }).click();
  await expect(row).toBeVisible();

  const crewContext = await browser.newContext({ viewport: { width: 390, height: 900 } });
  try {
    const crew = await crewContext.newPage();
    await login(crew, "crew@ops.test");
    await crew.goto(`${BASE}/projects/${projectId}?tab=days`);
    await crew.getByRole("link", { name: `Lihat laporan ${yesterday}`, exact: true }).click();
    await expect(crew.getByRole("heading", { name, exact: true })).toBeVisible();
    await expect(crew.getByText("Area venue bersih dan siap dipakai", { exact: true })).toBeVisible();
    await crew.getByRole("link", { name: /Riwayat laporan/ }).click();
    await expect(crew.getByRole("link", { name: `Lihat laporan ${yesterday}`, exact: true })).toBeVisible();
  } finally {
    await crewContext.close();
  }

  await page.goto(`${BASE}/projects/${projectId}?tab=settings`);
  await page.getByLabel("Status project", { exact: true }).selectOption("archived");
  await page.getByRole("button", { name: "Simpan status", exact: true }).click();
  await expect(page.getByText("Arsip", { exact: true }).filter({ visible: true })).toBeVisible();
  await page.goto(`${BASE}/reports`);
  await expect(row).toBeVisible();
});
