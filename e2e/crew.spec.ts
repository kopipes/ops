import { readFile } from "node:fs/promises";
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
  await expect(page).toHaveURL(`${BASE}/`, { timeout: 30_000 });
}

/** Creates a project today with a template and crew/lead members. Returns id. */
async function createTodayProject(page: Page, name: string, opts: { lead?: boolean } = {}) {
  await page.goto(`${BASE}/projects/new`);
  await waitForHydration(page, 'ol[aria-label="Langkah wizard"]');
  const visible = page.locator("section:not([hidden])");

  await page.getByLabel("Kode project").fill(uniqueCode());
  await page.getByLabel("Nama project").fill(name);
  await page.getByLabel("Venue").fill("JCC");
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();

  // checklist: pick template with opening+closing items
  await page.getByLabel("Template untuk divisi owner").selectOption("demo-division-tpl-standard");
  await expect(page.getByRole("checkbox", { name: "Sertakan Area venue bersih dan siap dipakai", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Lanjut →" }).click();

  // members: add crew@ and promote to lead when requested
  const crewRow = page.locator("section:not([hidden]) li", { hasText: "crew@ops.test" }).first();
  await crewRow.locator('input[type="checkbox"]').check();
  if (opts.lead) {
    await crewRow.getByRole("combobox").selectOption("lead");
  }
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Simpan project" }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 20_000 });
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

test("a submitted opening remains in history and another report can be added", async ({ page }) => {
  await login(page, "manager@ops.test");
  const id = await createTodayProject(page, `Dup Guard ${Date.now()}`, { lead: true });

  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  await answerAllOk(page);
  await page.getByRole("button", { name: /Submit Opening/ }).click();
  await expect(page).toHaveURL(/submitted=/, { timeout: 20_000 });

  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  await expect(page.getByRole("heading", {name:"Laporan Opening (1)",exact:true})).toBeVisible();
  await expect(page.getByRole("button", {name:/Submit Opening/})).toBeVisible();
  await page.getByLabel(/Jam kejadian/).fill("10:45");
  await answerAllOk(page);
  await page.getByRole("button", {name:/Submit Opening/}).click();
  await expect(page).toHaveURL(/submitted=/);
  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  await expect(page.getByRole("heading", {name:"Laporan Opening (2)",exact:true})).toBeVisible();
  await expect(page.getByText(/10[.:]45/).first()).toBeVisible();

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
  test.setTimeout(60_000);
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

test("gallery keeps multiple photos on a checklist point and at the end of a report", async ({ page }) => {
  test.setTimeout(90_000);
  await login(page, "manager@ops.test");
  const projectId = await createTodayProject(page, `Upload beberapa foto ${Date.now()}`);
  const buffer = await readFile(PHOTO);
  const file = (name: string) => ({ name, mimeType: "image/jpeg", buffer });

  await page.goto(`${BASE}/projects/${projectId}/days/${today()}/opening`);
  await answerAllOk(page);
  const unopenedPoint = page.locator("li", { has: page.getByRole("button", { name: "+ Tambah foto", exact: true }) }).first();
  const pointLabel = (await unopenedPoint.locator("p").first().textContent())!.replace(/\s+\*$/, "").trim();
  await unopenedPoint.getByRole("button", { name: "+ Tambah foto", exact: true }).click();
  const pointPicker = page.getByLabel(`Pilih foto galeri untuk ${pointLabel}`, { exact: true });
  const optionalPoint = page.locator("li").filter({ has: pointPicker });
  await expect(pointPicker).toHaveAttribute("multiple", "");
  const otherAccount = await page.request.post("/api/photos", { multipart: { formUserId: "another-account" } });
  expect(otherAccount.status()).toBe(409);
  const olderForm = await page.request.post("/api/photos", { multipart: { source: "gallery" } });
  expect(olderForm.status()).toBe(409);

  let releaseFirst!: () => void;
  const gate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let uploadStarted!: () => void;
  const firstUpload = new Promise<void>((resolve) => { uploadStarted = resolve; });
  let held = false;
  await page.route("**/api/photos", async (route) => {
    if (route.request().method() === "POST" && !held) {
      held = true;
      uploadStarted();
      await gate;
    }
    await route.continue();
  });

  try {
    await pointPicker.setInputFiles([file("point-1.jpg"), file("point-2.jpg")]);
    await firstUpload;
    const general = page.getByLabel("Pilih foto umum dari galeri", { exact: true });
    await general.setInputFiles(file("general-1.jpg"));
    await general.setInputFiles(file("general-2.jpg"));
    await expect(page.getByRole("button", { name: "Menunggu foto…", exact: true })).toBeDisabled();
  } finally {
    releaseFirst();
  }

  await expect(optionalPoint.getByText("2 foto terlampir", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Perbesar Foto laporan 2", exact: true })).toBeVisible();
  await page.route("**/api/photos", (route) => route.fulfill({
    status: 400, json: { error: "Foto pengujian ditolak" },
  }), { times: 1 });
  await page.getByLabel("Pilih foto umum dari galeri", { exact: true }).setInputFiles(file("rejected.jpg"));
  await expect(page.getByRole("alert").filter({ hasText: "Foto pengujian ditolak" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit Opening", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Lewati foto yang gagal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Submit Opening", exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Perbesar Foto laporan 2", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Submit Opening", exact: true }).click();
  await expect(page).toHaveURL(/submitted=/);
  const reportId = new URL(page.url()).searchParams.get("submitted")!;
  await page.getByRole("link", { name: /Lihat detail hari/ }).click();
  const report = page.locator(`#report-${reportId}`);
  await expect(report.locator('li[id^="point-"]').filter({ hasText: pointLabel }).locator("img")).toHaveCount(2);
  await expect(report.locator('section[id^="photo-"]')).toHaveCount(2);
});
