import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3113";
const password = "RegistrationTest2026!";

async function login(page: Page, email: string, pass = "OpsDemo2026!") {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(pass);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
}

async function register(page: Page, email: string, division: string) {
  await page.goto("/login");
  await page.getByRole("link", { name: "Daftar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Daftar akun Pulse" })).toBeVisible();
  // A placeholder plus the seeded divisions. The exact total is not a business
  // rule: other specs create divisions (e.g. "Divisi D…"), so asserting a fixed
  // count makes this fail on suite order. Assert it is populated and that the
  // divisions this spec selects are offered.
  const divisionOptions = page.locator('select[name="primaryDivisionId"] option');
  await expect(divisionOptions.first()).toBeAttached();
  expect(await divisionOptions.count()).toBeGreaterThan(1);
  await expect(divisionOptions.filter({ hasText: "Event Production" })).toHaveCount(1);
  await page.getByLabel("Nama lengkap").fill("Crew Registrasi");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.locator('select[name="primaryDivisionId"]').selectOption({ label: division });
  await page.getByLabel("Password (min. 8 karakter)", { exact: true }).fill(password);
  await page.getByLabel("Konfirmasi password").fill(password);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("register-form.png"), fullPage: true });
  await page.getByRole("button", { name: "Daftar", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?registered=1/);
  await expect(page.getByRole("status")).toContainText("Akun baru belum aktif");
}

test("registration requires scoped approval, and Manager cannot edit Admin", async ({ browser }) => {
  test.setTimeout(90_000);
  const crewContext = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const managerContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  for (const context of [crewContext, managerContext, adminContext]) context.setDefaultTimeout(10_000);
  try {
    const crew = await crewContext.newPage();
    const manager = await managerContext.newPage();
    const admin = await adminContext.newPage();
    const email = `signup-${Date.now()}@example.test`;
    const financeEmail = `finance-${Date.now()}@example.test`;

    await register(crew, email, "Event Production");
    expect(await crew.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await crewContext.cookies()).filter(cookie => cookie.name === "ops_session")).toHaveLength(0);
    await login(crew, email, password);
    await expect(crew.locator('form [role="alert"]')).toHaveText("Email atau password salah.");
    await register(crew, financeEmail, "Finance");

    await login(manager, "manager@ops.test");
    await expect(manager).toHaveURL(/\/$/);
    // Exercise in-app navigation and real Server Actions (not a full-page load).
    await manager.getByRole("link", { name: "User & aktivasi", exact: true }).click();
    await expect(manager.getByRole("heading", { name: "User", exact: true })).toBeVisible();
    await waitForHydration(manager, 'input[aria-label="Cari user"]');
    await expect(manager.getByRole("button", { name: "+ User", exact: true })).toHaveCount(0);
    await expect(manager.getByRole("button", { name: "Reset password", exact: true })).toHaveCount(0);
    await expect(manager.getByText("admin@ops.test", { exact: true })).toHaveCount(0);
    await expect(manager.getByText(financeEmail, { exact: true })).toHaveCount(0);
    await manager.getByRole("button", { name: /Menunggu aktivasi \(/ }).click();
    const row = manager.locator("li").filter({ hasText: email });
    await expect(row.getByText("Menunggu aktivasi", { exact: true })).toBeVisible();
    await manager.screenshot({ path: test.info().outputPath("manager-approval.png"), fullPage: true });

    // A forged target ID must be denied even though no Admin row is shown.
    const activation = row.locator("form");
    const originalId = await activation.locator('input[name="id"]').inputValue();
    await activation.locator('input[name="id"]').evaluate((input: HTMLInputElement) => { input.value = "usr-admin"; });
    await row.getByRole("button", { name: "Aktifkan", exact: true }).click();
    await expect(row.getByRole("alert")).toBeVisible();
    await activation.locator('input[name="id"]').evaluate((input: HTMLInputElement, value) => { input.value = value; }, originalId);
    await row.getByRole("button", { name: "Aktifkan", exact: true }).click();
    await expect(row).toHaveCount(0); // pending filter removes the approved account
    await manager.getByRole("button", { name: /Menunggu aktivasi \(/ }).click();
    await manager.getByLabel("Cari user").fill(email);
    await expect(row.getByRole("button", { name: "Nonaktifkan", exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(manager.locator('select[name="role"]')).toBeDisabled();
    await expect(manager.locator('select[name="primaryDivisionId"]')).toBeDisabled();
    await manager.getByLabel("Nama", { exact: true }).fill("Crew Sudah Diaktifkan");
    await manager.getByRole("button", { name: "Simpan perubahan", exact: true }).click();
    await expect(manager.getByRole("heading", { name: /Edit Crew/ })).toHaveCount(0);
    await expect(row.getByText("Crew Sudah Diaktifkan", { exact: true })).toBeVisible();

    await login(crew, email, password);
    await expect(crew).toHaveURL(/\/$/);
    await crew.goto("/admin/users");
    await expect(crew.getByText("Halaman ini hanya untuk Admin dan Manager.", { exact: true })).toBeVisible();
    await expect(crew.getByRole("button", { name: "Aktifkan", exact: true })).toHaveCount(0);

    await login(admin, "admin@ops.test");
    await expect(admin).toHaveURL(/\/$/); // forged Manager activation did not disable Admin
    await admin.getByRole("link", { name: "User & aktivasi", exact: true }).click();
    await admin.getByLabel("Cari user").fill(financeEmail);
    const finance = admin.locator("li").filter({ hasText: financeEmail });
    await expect(finance.getByText("Menunggu aktivasi", { exact: true })).toBeVisible();
    await finance.getByRole("button", { name: "Aktifkan", exact: true }).click();
    await expect(finance.getByRole("button", { name: "Nonaktifkan", exact: true })).toBeVisible();

    // Revoking the account also revokes an already signed-in session.
    await row.getByRole("button", { name: "Nonaktifkan", exact: true }).click();
    await expect(row.getByText("Nonaktif", { exact: true })).toBeVisible();
    await crew.goto("/");
    await expect(crew).toHaveURL(/\/login/);
  } finally {
    await Promise.race([Promise.allSettled([crewContext.close(), managerContext.close(), adminContext.close()]), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
});
