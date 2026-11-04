import { expect, test, type Page } from "@playwright/test";
import { waitForHydration } from "./helpers";

async function createProject(page: Page, name: string, code: string) {
  await page.goto("/projects/new");
  await waitForHydration(page, 'ol[aria-label="Langkah wizard"]');
  await page.getByLabel("Nama project", { exact: true }).fill(name);
  await page.getByLabel("Kode project", { exact: true }).fill(code);
  await page.getByLabel("Venue", { exact: true }).fill("Search Test Venue");
  for (let step = 0; step < 4; step++) await page.getByRole("button", { name: "Lanjut →", exact: true }).click();
  await page.getByRole("button", { name: "Simpan project", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  return new URL(page.url()).pathname.split("/").at(-1)!;
}

test("project/home/issue searches update without submit and project options are searchable", async ({ page }) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  const token = Date.now().toString().slice(-7);
  const alpha = `Search Alpha ${token}`;
  const beta = `Search Beta ${token}`;
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("manager@ops.test");
  await page.getByLabel("Password", { exact: true }).fill("OpsDemo2026!");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  const alphaId = await createProject(page, alpha, `EVT-2026-${token}1`);
  const betaId = await createProject(page, beta, `EVT-2026-${token}2`);

  await page.goto("/projects");
  const projectSearch = page.getByRole("searchbox", { name: "Cari project, kode, venue, atau client", exact: true });
  await projectSearch.fill(alpha);
  await expect(page.getByRole("link", { name: new RegExp(alpha) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(beta) })).toHaveCount(0);
  await expect(page).toHaveURL(/q=Search/);
  await projectSearch.fill(`EVT-2026-${token}2`);
  await expect(page.getByRole("link", { name: new RegExp(beta) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(alpha) })).toHaveCount(0);
  await projectSearch.fill("nothing-matches-xyz");
  await expect(page.getByText("Project tidak ditemukan untuk pencarian ini.", { exact: true })).toBeVisible();
  await projectSearch.fill("");
  await expect(page.getByRole("link", { name: new RegExp(alpha) })).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(beta) })).toBeVisible();

  await page.goto("/");
  const todaySearch = page.getByRole("searchbox", { name: "Cari project hari ini", exact: true });
  await todaySearch.fill(beta);
  await todaySearch.fill(alpha);
  await expect(page.getByText(alpha, { exact: true })).toBeVisible();
  await expect(page.getByText(beta, { exact: true })).toHaveCount(0);
  await expect(todaySearch).toHaveValue(alpha);
  await todaySearch.fill("");
  await expect(page.getByText(beta, { exact: true })).toBeVisible();

  await page.goto("/issues/new");
  await page.getByLabel("Project", { exact: true }).selectOption(alphaId);
  const issueTitle = `Lighting Alpha ${token}`;
  await page.getByLabel("Judul", { exact: true }).fill(issueTitle);
  await page.locator('select[name="categoryId"]').selectOption({ index: 1 });
  await page.getByLabel("Severity", { exact: true }).selectOption("high");
  await page.getByLabel("Next step / action plan", { exact: true }).fill("Cek lampu");
  await page.locator('input[type="file"]').first().setInputFiles("e2e/fixtures/test-photo.jpg");
  await expect(page.getByText(/1 foto terlampir/)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Buat issue", exact: true }).click();
  await expect(page).toHaveURL(/\/issues\/[0-9a-f-]{36}$/);

  await page.goto("/issues?open=1&active=1");
  const issueSearch = page.getByRole("searchbox", { name: "Cari issue atau project", exact: true });
  await issueSearch.fill("Lighting Alpha");
  await expect(page.getByRole("link", { name: new RegExp(issueTitle) })).toBeVisible();
  await expect(page).toHaveURL(/q=Lighting/);
  await page.getByRole("button", { name: /^Filter project:/ }).click();
  await page.getByRole("heading", { name: "Issues", exact: true }).click();
  await expect(page.getByRole("button", { name: /^Filter project:/ })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: /^Filter project:/ }).click();
  const optionSearch = page.getByRole("searchbox", { name: "Cari pilihan project", exact: true });
  await optionSearch.fill(beta);
  const choices = page.getByRole("group", { name: "Pilihan project", exact: true });
  await expect(choices.getByRole("button", { name: new RegExp(alpha) })).toHaveCount(0);
  await choices.getByRole("button", { name: new RegExp(beta) }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /^Filter project:/ })).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: /^Filter project:/ }).click();
  await choices.getByRole("button", { name: new RegExp(beta) }).click();
  await expect(page).toHaveURL(new RegExp(`projectId=${betaId}`));
  await expect(page.getByText("Tidak ada issue untuk filter ini.", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/open=1/);
  await expect(page).toHaveURL(/active=1/);
  await expect(issueSearch).toHaveValue("Lighting Alpha");

  await page.getByRole("button", { name: /^Filter project:/ }).click();
  await optionSearch.fill(alpha);
  await choices.getByRole("button", { name: new RegExp(alpha) }).click();
  await expect(page.getByRole("link", { name: new RegExp(issueTitle) })).toBeVisible();
  await page.getByRole("link", { name: "High", exact: true }).click();
  await expect(page).toHaveURL(/severity=high/);
  await expect(page).toHaveURL(new RegExp(`projectId=${alphaId}`));
  await expect(issueSearch).toHaveValue("Lighting Alpha");

  await page.setViewportSize({ width: 390, height: 844 });
  await issueSearch.fill("' OR 1=1 --");
  await expect(page.getByText("Tidak ada issue untuk filter ini.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await issueSearch.fill("");
  await expect(page.getByRole("link", { name: new RegExp(issueTitle) })).toBeVisible();
});
