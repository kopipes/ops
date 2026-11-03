/**
 * M3 Project E2E — wizard, detail tabs, members, visibility.
 * Requires the seed (pnpm db:seed).
 */
import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";
const PASSWORD = "OpsDemo2026!";

/**
 * Collision-resistant project code: the code column is UNIQUE, and random
 * 4-digit suffixes collide once the suite has run many times against one DB.
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

/** Walks the wizard end to end. Returns the created project's URL. */
async function createProjectViaWizard(
  page: Page,
  opts: { name: string; code: string; template?: boolean },
) {
  await page.goto(`${BASE}/projects/new`);

  // Step 1: basic info
  await page.getByLabel("Kode project").fill(opts.code);
  await page.getByLabel("Nama project").fill(opts.name);
  await page.getByLabel("Venue").fill("JCC Senayan");
  await page.getByLabel("Klien (opsional)").fill("PT Klien");
  await page.getByRole("button", { name: "Lanjut →" }).click();

  // Step 2: divisions (owner preselected)
  await expect(page.getByLabel("Divisi owner")).toBeVisible();
  await page.getByRole("button", { name: "Lanjut →" }).click();

  // Step 3: checklist — pick the first template if requested.
  // Scope to the visible section: hidden steps still contain checkboxes.
  const visible = page.locator("section:not([hidden])");
  if (opts.template !== false) {
    await visible.locator('fieldset input[type="checkbox"]').first().check();
    // Wait for the preview to render so hidden cl_* fields exist.
    await expect(page.locator('input[name="cl_label"]').first()).toBeAttached();
  }
  await page.getByRole("button", { name: "Lanjut →" }).click();

  // Step 4: members — add the crew user
  const crewRow = page.locator("section:not([hidden]) li", { hasText: "crew@ops.test" }).first();
  await crewRow.locator('input[type="checkbox"]').check();
  await page.getByRole("button", { name: "Lanjut →" }).click();

  // Step 5: save
  await page.getByRole("button", { name: "Simpan project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  return page.url();
}

test("manager can create a project through the wizard", async ({ page }) => {
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Pameran E2E ${Date.now()}`,
    code: uniqueCode(),
  });

  // Detail page loaded with the tabs.
  const tabs = page.getByRole("navigation", { name: "Tab project" });
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Hari ini" })).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`wizard shows only the current step at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await login(page, "manager@ops.test");
    await page.goto(`${BASE}/projects/new`);
    await waitForHydration(page, 'ol[aria-label="Langkah wizard"]');

    const steps = page.locator("main form > section");
    await expect(steps).toHaveCount(5);
    await expect(page.locator("main form > section:visible")).toHaveCount(1);
    await expect(steps.nth(0)).toBeVisible();
    await expect(page.getByRole("button", { name: "Simpan project" })).toBeHidden();

    await page.getByLabel("Nama project").fill("Wizard layout check");
    await page.getByLabel("Venue", { exact: true }).fill("JCC");
    await page.getByRole("button", { name: "Lanjut →" }).click();
    await expect(steps.nth(1)).toBeVisible();
    await expect(steps.nth(0)).toBeHidden();
    await expect(page.locator("main form > section:visible")).toHaveCount(1);

    await page.getByRole("button", { name: "← Kembali" }).click();
    await expect(steps.nth(0)).toBeVisible();
    await expect(steps.nth(1)).toBeHidden();
    await expect(page.getByLabel("Nama project")).toHaveValue("Wizard layout check");
  });
}

test("project days are generated from the date range", async ({ page }) => {
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Hari Test ${Date.now()}`,
    code: uniqueCode(),
    template: false,
  });

  await page.goto(`${url}?tab=days`);
  // The wizard defaults to a single day (today → today). Scope to <main>: the
  // desktop sidebar also has an "Hari Ini" item, which is hidden at this width.
  await expect(page.locator("main li", { hasText: "hari ini" }).first()).toBeVisible();
});

test("checklist snapshot appears on the Checklist tab", async ({ page }) => {
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Checklist Test ${Date.now()}`,
    code: uniqueCode(),
  });

  await page.goto(`${url}?tab=checklist`);
  await expect(page.getByText(/item aktif/)).toBeVisible();
  // The seeded "Standar Event Harian" template's first opening item.
  await expect(page.getByText("Area venue bersih dan siap dipakai").first()).toBeVisible();
});

test("member added in the wizard appears on the Member tab", async ({ page }) => {
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Member Test ${Date.now()}`,
    code: uniqueCode(),
  });

  await page.goto(`${url}?tab=members`);
  await expect(page.getByText("crew@ops.test")).toBeVisible();
});

test("lead promotion works on the Member tab", async ({ page }) => {
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Lead Test ${Date.now()}`,
    code: uniqueCode(),
  });

  await page.goto(`${url}?tab=members`);
  await page.getByRole("button", { name: "Jadikan Head Crew" }).first().click();
  await expect(page.getByText("lead", { exact: true }).first()).toBeVisible();
});

test("project settings show windows disabled by default", async ({ page }) => {
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Settings Test ${Date.now()}`,
    code: uniqueCode(),
    template: false,
  });

  await page.goto(`${url}?tab=settings`);
  await expect(page.getByText("Nonaktif — bebas jam", { exact: true })).toHaveCount(2);
});

test("crew cannot open the wizard (§12)", async ({ page }) => {
  await login(page, "crew@ops.test");
  await page.goto(`${BASE}/projects/new`);
  await expect(page).toHaveURL(`${BASE}/`);
});

test("project visibility follows §2.2 for crew, multi-division and corporate", async ({
  page,
  browser,
}) => {
  // Manager (d-evt owner) creates a project.
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Private ${Date.now()}`,
    code: uniqueCode(),
    template: false,
  });

  // Each role gets its own cookie jar; reusing one context across logins is what
  // made this flaky before.
  for (const email of ["crew@ops.test", "multi@ops.test", "corporate@ops.test"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const p2 = await ctx.newPage();
    await p2.goto(`${BASE}/login`);
    await p2.getByLabel("Email").fill(email);
    await p2.getByLabel("Password").fill(PASSWORD);
    await p2.getByRole("button", { name: "Masuk" }).click();
    await expect(p2).toHaveURL(`${BASE}/`);

    await p2.goto(url);
    await expect(p2.getByRole("navigation", { name: "Tab project" })).toBeVisible();
    await ctx.close();
  }
});

test("admin can transition project status to completed", async ({ page }) => {
  await login(page, "admin@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Status Test ${Date.now()}`,
    code: uniqueCode(),
    template: false,
  });

  await page.goto(`${url}?tab=settings`);
  await page.getByLabel("Status project").selectOption("completed");
  await page.getByRole("button", { name: "Simpan status" }).click();

  await expect(page.getByText("Selesai").first()).toBeVisible();
});
