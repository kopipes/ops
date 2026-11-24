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
    await page.getByLabel("Template untuk divisi owner").selectOption("demo-division-tpl-standard");
    // Wait for the preview to render so hidden cl_* fields exist.
    await expect(page.getByRole("checkbox", { name: "Sertakan Area venue bersih dan siap dipakai", exact: true })).toBeVisible();
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

test("project creator appears as Owner separately from the member added in the wizard", async ({ page }) => {
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Member Test ${Date.now()}`,
    code: uniqueCode(),
  });

  await page.goto(`${url}?tab=members`);
  await expect(page.getByText("crew@ops.test", { exact: true })).toBeVisible();
  await expect(page.getByText("Owner: Manager Event", { exact: true })).toBeVisible();
  await expect(page.getByText("manager@ops.test", { exact: true })).toHaveCount(0);
});

test("Owner can promote a Crew member but Head Crew cannot change member access", async ({ page, browser }) => {
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Lead Test ${Date.now()}`,
    code: uniqueCode(),
  });

  await page.goto(`${url}?tab=members`);
  const member = page.locator("li").filter({ hasText: "crew@ops.test" });
  await member.getByRole("combobox").selectOption("lead");
  await member.getByRole("button", { name: "Simpan akses" }).click();
  await expect(member.locator("span").filter({ hasText: /^Head Crew$/ })).toBeVisible();

  const crewContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const crewPage = await crewContext.newPage();
    await login(crewPage, "crew@ops.test");
    await crewPage.goto(`${url}?tab=members`);
    await expect(crewPage.getByText("Head Crew", { exact: true })).toBeVisible();
    await expect(crewPage.getByRole("button", { name: "Simpan akses" })).toHaveCount(0);
    await expect(crewPage.getByText("Tambah member", { exact: true })).toHaveCount(0);
  } finally {
    await crewContext.close();
  }

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

test("checklist changes apply next time and Admin Project can download the old report", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await login(page, "manager@ops.test");
  const project = await createProjectViaWizard(page, {
    name: `Checklist live ${Date.now()}`,
    code: uniqueCode(),
    template: false,
  });
  const checklist = `${project}?tab=checklist`;
  await page.goto(checklist);
  await page.getByRole("link", { name: "Edit checklist" }).click();
  let monitoring = page.getByRole("region", { name: "Monitoring" });
  await monitoring.getByRole("button", { name: "+ Tambah poin" }).click();
  await monitoring.getByLabel("Nama poin").fill("Periksa lampu");
  await page.getByRole("button", { name: "Simpan checklist" }).click();
  await expect(page.getByRole("status")).toHaveText("Checklist tersimpan.");

  await page.goto(project);
  await page.getByRole("listitem").filter({ hasText: "monitoring" }).getByRole("link", { name: "Isi", exact: true }).click();
  await waitForHydration(page, "#notes");
  await page.locator("#notes").fill("Penerangan berfungsi.");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.getByRole("button", { name: "Submit Monitoring", exact: true }).click();
  await expect(page).toHaveURL(/submitted=/);
  const detail = await page.getByRole("link", { name: /Lihat detail hari/ }).getAttribute("href");
  expect(detail).toBeTruthy();

  await page.goto(checklist);
  await page.getByRole("link", { name: "Edit checklist" }).click();
  monitoring = page.getByRole("region", { name: "Monitoring" });
  await monitoring.getByText("Periksa lampu", { exact: true }).click();
  await monitoring.getByLabel("Nama poin").fill("Periksa lampu darurat");
  await monitoring.getByRole("button", { name: "+ Tambah poin" }).click();
  await monitoring.getByLabel("Nama poin").last().fill("Periksa ventilasi");
  await monitoring.getByRole("button", { name: "Naikkan Periksa ventilasi" }).click();
  await page.getByRole("button", { name: "Simpan checklist" }).click();
  await expect(page.getByRole("status")).toHaveText("Checklist tersimpan.");
  await page.getByText("Riwayat perubahan checklist", { exact: true }).click();
  await expect(page.getByText("Diubah · Monitoring · Periksa lampu → Periksa lampu darurat", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.goto(`${project}?tab=members`);
  const row = page.locator("li").filter({ hasText: "crew@ops.test" });
  await row.getByRole("combobox").selectOption("admin_project");
  await row.getByRole("button", { name: "Simpan akses" }).click();
  await expect(row.locator("span").filter({ hasText: /^Admin Project$/ })).toBeVisible();

  const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  try {
    const viewer = await viewerContext.newPage();
    await login(viewer, "crew@ops.test");
    await viewer.goto(`${BASE}${detail}`);
    await expect(viewer.getByText("Periksa lampu", { exact: true })).toBeVisible();
    await expect(viewer.getByText("Periksa lampu darurat", { exact: true })).toHaveCount(0);
    await expect(viewer.getByRole("button", { name: "Mark as Reviewed" })).toHaveCount(0);
    await expect(viewer.getByRole("link", { name: "Report", exact: true }).first()).toBeVisible();
    const download = viewer.waitForEvent("download", { timeout: 45_000 });
    await viewer.getByRole("button", { name: "Export PDF laporan harian", exact: true }).click();
    expect((await download).suggestedFilename()).toMatch(/^laporan-.*\.pdf$/);
    await viewer.goto(`${project}?tab=settings`);
    await expect(viewer.getByRole("button", { name: "Export PDF rekap project", exact: true })).toBeVisible();
    await viewer.goto(`${checklist}&edit=1`);
    await expect(viewer.getByRole("button", { name: "Simpan checklist" })).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }
});

test("Owner can edit saved project details and Crew cannot open the editor", async ({ page, browser }) => {
  await login(page, "manager@ops.test");
  const url = await createProjectViaWizard(page, {
    name: `Edit project ${Date.now()}`, code: uniqueCode(), template: false,
  });
  const updatedName = `Project diperbarui ${Date.now()}`;
  await page.goto(`${url}?tab=settings`);
  await page.getByRole("link", { name: "Edit detail project", exact: true }).click();
  await page.getByLabel("Nama project", { exact: true }).fill(updatedName);
  await page.getByLabel("Venue", { exact: true }).fill("Venue baru");
  await page.getByLabel("Deskripsi (opsional)", { exact: true }).fill("Detail operasional terbaru");
  await page.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Detail project tersimpan.");
  await expect(page.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
  await expect(page.getByText("Detail operasional terbaru", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  const crew = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  try {
    const viewer = await crew.newPage();
    await login(viewer, "crew@ops.test");
    await viewer.goto(`${url}?tab=settings&edit=1`);
    await expect(viewer.getByRole("heading", { name: updatedName, exact: true })).toBeVisible();
    await expect(viewer.getByLabel("Nama project", { exact: true })).toHaveCount(0);
  } finally {
    await crew.close();
  }
});
