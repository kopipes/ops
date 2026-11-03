/**
 * Admin surfaces + report editing E2E.
 * Covers the "can't launch without it" items: onboarding users/divisions,
 * and correcting a submitted report.
 */
import { expect, test, type Page } from "@playwright/test";
import { today, waitForHydration } from "./helpers";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3113";
const PASSWORD = "OpsDemo2026!";

test.use({ viewport: { width: 390, height: 900 } });

function uniqueCode() {
  return `EVT-2026-${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 100)
    .toString()
    .padStart(2, "0")}`;
}

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
}

async function loginOk(page: Page, email: string, password = PASSWORD) {
  await login(page, email, password);
  await expect(page).toHaveURL(`${BASE}/`);
}

// ---------------------------------------------------------------------------
// Admin: users
// ---------------------------------------------------------------------------

test("admin can create a user who can then log in (§14 AC)", async ({ page, browser }) => {
  await loginOk(page, "admin@ops.test");
  await page.goto(`${BASE}/admin/users`);

  const email = `crew${Date.now()}@ops.test`;
  await page.getByRole("button", { name: "+ User" }).click();
  await page.getByLabel("Nama").fill("Crew Baru E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Role").selectOption("user");
  await page.getByLabel("Password awal (min. 8 karakter)").fill("password-awal-1");
  await page.getByRole("button", { name: "Buat user" }).click();

  // The new user appears in the list, flagged to change password.
  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText("Ganti password").first()).toBeVisible();

  // And the account actually works: logging in forces a password change.
  // A fresh context is required — /login redirects to / while the admin's own
  // session cookie is still present, so the form would never render.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const fresh = await ctx.newPage();
  await login(fresh, email, "password-awal-1");
  await expect(fresh).toHaveURL(/\/me\/password/);
  await ctx.close();
});

test("admin can reset a password and the old one stops working", async ({ page, browser }) => {
  await loginOk(page, "admin@ops.test");
  await page.goto(`${BASE}/admin/users`);

  const email = `reset${Date.now()}@ops.test`;
  await page.getByRole("button", { name: "+ User" }).click();
  await page.getByLabel("Nama").fill("Reset Target");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password awal (min. 8 karakter)").fill("password-awal-1");
  await page.getByRole("button", { name: "Buat user" }).click();
  await expect(page.getByText(email)).toBeVisible();

  // Reset the password.
  await page
    .locator("li", { hasText: email })
    .first()
    .getByRole("button", { name: "Reset password" })
    .click();
  await page.getByLabel(/Password baru untuk/).fill("password-baru-2");
  await page.getByRole("button", { name: "Simpan password" }).click();
  await expect(page.getByText("Password direset.")).toBeVisible();

  // The OLD password must now fail.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const p2 = await ctx.newPage();
  await login(p2, email, "password-awal-1");
  await expect(p2.getByText("Email atau password salah.")).toBeVisible();

  // The new one works (and forces a change).
  await login(p2, email, "password-baru-2");
  await expect(p2).toHaveURL(/\/me\/password/);
  await ctx.close();
});

test("admin can deactivate a user and their session dies (§14 AC)", async ({ page, browser }) => {
  await loginOk(page, "admin@ops.test");
  await page.goto(`${BASE}/admin/users`);

  const email = `deact${Date.now()}@ops.test`;
  await page.getByRole("button", { name: "+ User" }).click();
  await page.getByLabel("Nama").fill("Deact Target");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password awal (min. 8 karakter)").fill("password-awal-1");
  await page.getByRole("button", { name: "Buat user" }).click();
  await expect(page.getByText(email)).toBeVisible();

  // Give them a live session first.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const p2 = await ctx.newPage();
  await p2.goto(`${BASE}/login`);
  await p2.getByLabel("Email").fill(email);
  await p2.getByLabel("Password").fill("password-awal-1");
  await p2.getByRole("button", { name: "Masuk" }).click();
  await expect(p2).toHaveURL(/\/me\/password/);

  await page
    .locator("li", { hasText: email })
    .first()
    .getByRole("button", { name: "Nonaktifkan" })
    .click();
  await expect(page.getByText("Nonaktif").first()).toBeVisible();

  // The live session must be invalidated immediately.
  await p2.goto(`${BASE}/`);
  await expect(p2).toHaveURL(/\/login/);

  // And they cannot log in again.
  await login(p2, email, "password-awal-1");
  await expect(p2.getByText("Email atau password salah.")).toBeVisible();
  await ctx.close();
});

test("manager can manage crew but not the admin-only surfaces (§2.3)", async ({ page }) => {
  await loginOk(page, "manager@ops.test");

  // Managers may reach user management, scoped to crew in their own division.
  await page.goto(`${BASE}/admin/users`);
  await expect(page.getByText(/Kelola crew dengan divisi utama di divisi Anda/)).toBeVisible();
  await expect(page.getByText(/hanya untuk Admin/)).toHaveCount(0);

  // Admin-only surfaces stay closed.
  await page.goto(`${BASE}/admin/audit`);
  await expect(page.getByText(/hanya untuk Admin/)).toBeVisible();

  await page.goto(`${BASE}/admin/settings`);
  await expect(page.getByText(/hanya untuk Admin/)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Admin: divisions
// ---------------------------------------------------------------------------

test("admin can create a division and it appears in project options", async ({ page }) => {
  await loginOk(page, "admin@ops.test");
  await page.goto(`${BASE}/admin/divisions`);

  const code = `D${Math.floor(Math.random() * 9000 + 1000)}`;
  await page.getByRole("button", { name: "+ Divisi" }).click();
  await page.getByLabel(/Kode/).fill(code);
  await page.getByLabel("Nama divisi").fill(`Divisi ${code}`);
  await page.getByRole("button", { name: "Buat divisi" }).click();

  await expect(page.getByText(`Divisi ${code}`)).toBeVisible();
});

// ---------------------------------------------------------------------------
// Admin: settings
// ---------------------------------------------------------------------------

test("admin settings persist and feed the project wizard defaults", async ({ page }) => {
  await loginOk(page, "admin@ops.test");
  await page.goto(`${BASE}/admin/settings`);

  const openingWasEnabled = await page.getByLabel("Gunakan window opening", { exact: true }).isChecked();
  const openingStartBefore = await page.locator('input[name="defaultOpeningWindowStart"]').inputValue();
  await page.getByLabel("Gunakan window opening", { exact: true }).check();
  await page.getByLabel("Mulai").first().fill("05:30");
  await page.getByRole("button", { name: "Simpan setelan" }).click();
  await expect(page.getByText("Setelan tersimpan.")).toBeVisible();

  // The wizard's step 5 should now default to the stored value.
  await page.goto(`${BASE}/projects/new`);
  await page.getByLabel("Nama project").fill("Window defaults preview");
  await page.getByLabel("Venue", { exact: true }).fill("JCC");
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await expect(page.getByLabel("Opening mulai")).toHaveValue("05:30");

  // Restore the global default. These settings are shared by every project, so
  // leaving the window enabled makes other spec files (which assert the
  // disabled-by-default state) pass or fail depending on execution order.
  // Restore the value AND the checkbox in one submit: saving them in two steps
  // left the window enabled when the second submit was skipped.
  await page.goto(`${BASE}/admin/settings`);
  const openingToggle = page.getByLabel("Gunakan window opening", { exact: true });
  if (openingWasEnabled) await openingToggle.check();
  else await openingToggle.uncheck();
  await page.getByLabel("Mulai").first().fill(openingStartBefore);
  await page.getByRole("button", { name: "Simpan setelan" }).click();
  await expect(page.getByText("Setelan tersimpan.")).toBeVisible();
});

test("admin audit log records actions and filters (§9.5 no.7)", async ({ page }) => {
  await loginOk(page, "admin@ops.test");
  await page.goto(`${BASE}/admin/audit`);

  await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();

  // Scope to the results list: the filter <select> also renders these strings
  // as <option>s, which are "hidden" and would win an unscoped getByText.
  const list = page.locator("ul li");
  await expect(list.filter({ hasText: "auth.login" }).first()).toBeVisible();

  // Filter by action.
  await page.getByLabel("Aksi").selectOption("auth.login");
  await page.getByRole("button", { name: "Terapkan filter" }).click();
  await expect(list.filter({ hasText: "auth.login" }).first()).toBeVisible();
  await expect(list.filter({ hasText: "report.submitted" })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Report editing (§13.1, §9.5 no.4)
// ---------------------------------------------------------------------------

async function createProjectAndOpening(page: Page, name: string) {
  await page.goto(`${BASE}/projects/new`);
  const visible = page.locator("section:not([hidden])");
  await page.getByLabel("Kode project").fill(uniqueCode());
  await page.getByLabel("Nama project").fill(name);
  await page.getByLabel("Venue").fill("JCC");
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await visible.locator('fieldset input[type="checkbox"]').first().check();
  await expect(page.locator('input[name="cl_label"]').first()).toBeAttached();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Lanjut →" }).click();
  await page.getByRole("button", { name: "Simpan project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  return page.url().match(/\/projects\/([0-9a-f-]{36})/)![1];
}


test("author can edit a submitted report and a revision is recorded (§9.5 no.4)", async ({ page }) => {
  // This test does the full round trip (create project -> 10 photo uploads ->
  // submit -> review the edit). The default 30s budget is not enough on a cold
  // dev server; it needs ~25s of setup before the save even starts.
  test.setTimeout(120_000);
  await loginOk(page, "manager@ops.test");
  const name = `Edit Report ${Date.now()}`;
  const id = await createProjectAndOpening(page, name);

  // Submit an opening with every item OK (photos attached where required).
  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  const cards = page.locator("li", { has: page.getByRole("button", { name: "OK", exact: true }) });
  const count = await cards.count();
  const photo = "e2e/fixtures/test-photo.jpg";
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.getByRole("button", { name: "OK", exact: true }).click();
    const fileInput = card.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles(photo);
      await expect(card.getByText(/foto terlampir/)).toBeVisible({ timeout: 25_000 });
    }
  }
  await page.getByRole("button", { name: /Submit Opening/ }).click();
  await expect(page).toHaveURL(/submitted=/, { timeout: 30_000 });

  // Wait for the day page to settle before navigating away, otherwise the
  // following goto can race the in-flight submit response.
  await expect(page.getByText(/✓ terisi/)).toBeVisible({ timeout: 20_000 });

  // Open the edit page from the day detail.
  await page.goto(`${BASE}/reports?status=all`);
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await expect(page).toHaveURL(/\/reports\/day\//);
  await page.getByRole("link", { name: "Lihat / Edit" }).first().click();
  await expect(page).toHaveURL(/\/reports\/edit\//);

  // Flip the first item to "Tidak OK" with a note, then save.
  // These buttons are client-side: wait for hydration or the click is a no-op.
  await waitForHydration(page, 'li button[aria-pressed]');
  const editCards = page.locator("li", { has: page.getByRole("button", { name: "Tidak OK" }) });
  await editCards.first().getByRole("button", { name: "Tidak OK" }).click();
  await expect(editCards.first().getByRole("button", { name: "Tidak OK" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // Per-item note. Target the aria-label directly: /Catatan / also matches the
  // "Catatan umum" field, and .first() would silently pick whichever won.
  await page
    .locator('textarea[aria-label^="Catatan "]:not([aria-label="Catatan umum"])')
    .first()
    .fill("Lampu putus saat dicek");
  await page.getByRole("button", { name: "Simpan perubahan" }).click();

  // Generous timeout: the action writes a revision inside a transaction first.
  await expect(page).toHaveURL(/saved=1/, { timeout: 30_000 });
  await expect(page.getByText("Perubahan tersimpan.")).toBeVisible();

  // "Diedit oleh" + revision history are present.
  await expect(page.getByText(/Diedit oleh/).first()).toBeVisible();
  await expect(page.getByText(/Riwayat versi/)).toBeVisible();
});

test("a reviewed day blocks editing (§13.1)", async ({ page }) => {
  test.setTimeout(120_000); // full project + photo upload round trip, as above
  await loginOk(page, "manager@ops.test");
  const name = `Edit Locked ${Date.now()}`;
  const id = await createProjectAndOpening(page, name);

  await page.goto(`${BASE}/projects/${id}/days/${today()}/opening`);
  const cards = page.locator("li", { has: page.getByRole("button", { name: "OK", exact: true }) });
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    await card.getByRole("button", { name: "OK", exact: true }).click();
    const fileInput = card.locator('input[type="file"]').first();
    if ((await fileInput.count()) > 0) {
      await fileInput.setInputFiles("e2e/fixtures/test-photo.jpg");
      await expect(card.getByText(/foto terlampir/)).toBeVisible({ timeout: 25_000 });
    }
  }
  await page.getByRole("button", { name: /Submit Opening/ }).click();
  await expect(page).toHaveURL(/submitted=/, { timeout: 30_000 });

  // Review the day.
  await page.goto(`${BASE}/reports?status=all`);
  await page.getByRole("link", { name: new RegExp(name) }).first().click();
  await page.getByRole("button", { name: "Mark as Reviewed" }).click();
  await expect(page.getByText(/Direview oleh/)).toBeVisible();

  // Editing is now refused with an explanation.
  await page.getByRole("link", { name: "Lihat / Edit" }).first().click();
  await expect(page.getByText(/sudah direview/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Simpan perubahan" })).toHaveCount(0);
});
