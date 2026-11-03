/**
 * M4 Crew flow E2E — opening/monitoring/closing in a real browser.
 * Requires the seed. Creates its own project per test to stay order-independent.
 */
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { today, waitForHydration } from "./helpers";

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

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";
const PASSWORD = "OpsDemo2026!";

test.use({ viewport: { width: 390, height: 844 } });

async function login(page: Page, email: string) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Masuk" }).click();
  await expect(page).toHaveURL(`${BASE}/`);
}

/** Creates a project today with a template and crew/lead members. Returns id. */
async function createTodayProject(page: Page, name: string, opts: { lead?: boolean } = {}) {
  await page.goto(`${BASE}/projects/new`);
  const visible = page.locator("section:not([hidden])");

  await page.getByLabel("Kode project").fill(uniqueCode());
  await page.getByLabel("Nama project").fill(name);
  await page.getByLabel("Venue").fill("JCC");
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();

  // checklist: pick template with opening+closing items
  await visible.locator('fieldset input[type="checkbox"]').first().check();
  await expect(page.locator('input[name="cl_label"]').first()).toBeAttached();
  await page.getByRole("button", { name: "Lanjut →" }).click();

  // members: add crew@ and promote to lead when requested
  const crewRow = page.locator("section:not([hidden]) li", { hasText: "crew@ops.test" }).first();
  await crewRow.locator('input[type="checkbox"]').check();
  if (opts.lead) {
    await crewRow.getByLabel(/Peran/).selectOption("lead");
  }
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Simpan project" }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  const id = page.url().match(/\/projects\/([0-9a-f-]{36})/)![1];
  return id;
}


/**
 * Answers every checklist item as OK and attaches a photo to any item that
 * exposes a file input. The seeded template marks several items `requires_photo`,
 * so a submit without photos is correctly rejected (§8.1).
 */
async function answerAllOk(page: Page) {
  // The OK/NOT_OK buttons are client components: clicking before React attaches
  // is a silent no-op, which then fails later with a confusing timeout.
  await waitForHydration(page, 'li button[aria-pressed]');
  const cards = page.locator("li", { has: page.getByRole("button", { name: "OK", exact: true }) });
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.getByRole("button", { name: "OK", exact: true }).click();
    // A card offers two pickers (camera + gallery); take one.
    const fileInput = card.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(PHOTO);
      // Wait for the upload round-trip so the photo id is attached.
      await expect(card.getByText(/foto terlampir/)).toBeVisible({ timeout: 20_000 });
    }
  }
  return count;
}

test("home shows today's project card with phase status (§4.2)", async ({ page }) => {
  await login(page, "manager@ops.test");
  await createTodayProject(page, `Home Card ${Date.now()}`, { lead: true });

  await page.goto(`${BASE}/`);
  await expect(page.getByRole("heading", { name: "Hari ini" })).toBeVisible();
  await expect(page.getByText("Opening").first()).toBeVisible();
  await expect(page.getByText("Monitoring").first()).toBeVisible();
  await expect(page.getByText("Closing").first()).toBeVisible();
});

test("lead can submit an opening report end to end", async ({ page }) => {
  await login(page, "manager@ops.test");
  const id = await createTodayProject(page, `Opening Submit ${Date.now()}`, { lead: true });

  // Manager can also submit; use the crew-specific route directly.
  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  await expect(page.getByRole("heading", { name: "Opening" })).toBeVisible();

  // Answer every required item as OK. Items requiring a photo would block submit,
  // so answer those as OK too and attach no photo only if optional.
  const count = await answerAllOk(page);
  expect(count).toBeGreaterThan(0);

  await page.getByRole("button", { name: /Submit Opening/ }).click();

  // A successful submit redirects to the day page, which now shows "✓ terisi".
  await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });
  await expect(page.getByText(/✓ terisi/)).toBeVisible();
});

test("NOT OK without a note is rejected with a clear message", async ({ page }) => {
  await login(page, "manager@ops.test");
  const id = await createTodayProject(page, `Validation ${Date.now()}`, { lead: true });

  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);

  await answerAllOk(page);
  // Flip the first item to "Tidak OK" and leave the note empty.
  const cards = page.locator("li", { has: page.getByRole("button", { name: "OK", exact: true }) });
  await cards.nth(0).getByRole("button", { name: "Tidak OK" }).click();

  await page.getByRole("button", { name: /Submit Opening/ }).click();
  await expect(page.locator('form p[role="alert"]').first()).toContainText(/Catatan wajib/);
});

test("monitoring can be submitted repeatedly (§4.4)", async ({ page, browser }) => {
  // The manager creates the project with crew@ as a member, in its own context.
  const mgrCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mgrPage = await mgrCtx.newPage();
  await login(mgrPage, "manager@ops.test");
  const id = await createTodayProject(mgrPage, `Monitoring ${Date.now()}`);
  await mgrCtx.close();

  await login(page, "crew@ops.test");
  await page.goto(`${BASE}/projects/${id}/days/${today()}/monitoring`);
  await expect(page.getByRole("heading", { name: "Monitoring" })).toBeVisible();

  for (const note of ["Observasi pertama", "Observasi kedua"]) {
    await page.getByLabel(/Observasi \/ catatan/).fill(note);
    await page.getByRole("button", { name: /Submit Monitoring/ }).click();
    await expect(page).toHaveURL(/submitted=/, { timeout: 15_000 });
    await page.goto(`${BASE}/projects/${id}/days/${today()}/monitoring`);
  }

  await page.goto(`${BASE}/projects/${id}?tab=today`);
  await expect(page.getByText(/2 laporan/)).toBeVisible();
});

test("a submitted opening is read-only and blocks a second one (§4.6)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const id = await createTodayProject(page, `Dup Guard ${Date.now()}`, { lead: true });

  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  await answerAllOk(page);
  await page.getByRole("button", { name: /Submit Opening/ }).click();
  await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });

  // Revisit: must render read-only with the explanation and no submit button.
  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  await expect(page.getByText(/Opening sudah diisi/)).toBeVisible();
  await expect(page.getByText(/Satu laporan per hari/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit Opening/ })).toHaveCount(0);
});

test("plain crew sees opening read-only (§4.6)", async ({ page, browser }) => {
  const mgrCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mgrPage = await mgrCtx.newPage();
  await login(mgrPage, "manager@ops.test");
  const id = await createTodayProject(mgrPage, `Crew RO ${Date.now()}`); // crew, not lead
  await mgrCtx.close();

  await login(page, "crew@ops.test");
  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);

  await expect(page.getByText(/Hanya Head Crew/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit Opening/ })).toHaveCount(0);
});

test("draft survives a reload (§4.3 no.8)", async ({ page }) => {
  await login(page, "manager@ops.test");
  const id = await createTodayProject(page, `Draft ${Date.now()}`, { lead: true });

  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  const itemCards = page.locator("li", { has: page.getByRole("button", { name: "OK", exact: true }) });
  await itemCards.nth(0).getByRole("button", { name: "OK", exact: true }).click();
  await page.getByLabel(/Catatan umum/).fill("Draft note E2E");

  // Wait for the debounced autosave, then reload.
  await page.waitForTimeout(1200);
  await page.reload();

  await expect(page.getByText("Draft dipulihkan dari perangkat ini.")).toBeVisible();
  await expect(page.getByLabel(/Catatan umum/)).toHaveValue("Draft note E2E");

  /*
   * Regression: the autosave used to coerce unanswered items to "ok", so a
   * restored draft came back "answered but photoless" and submit failed with
   * "Foto wajib untuk item: …" on a form that looked completely filled in.
   * Only the one item the crew actually answered must be restored.
   */
  const answered = await page.$$eval("li button[aria-pressed]", (els) =>
    els.filter((e) => e.getAttribute("aria-pressed") === "true").length,
  );
  expect(answered).toBe(1);
});
