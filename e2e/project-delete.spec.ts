import { expect, test, type Page } from "@playwright/test";
import { today, waitForHydration } from "./helpers";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("OpsDemo2026!");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
}

for (const width of [390, 1440]) {
  test(`Admin can confirm project deletion; Manager cannot delete at ${width}px`, async ({ page, browser }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await login(page, "admin@ops.test");
    const code = `EVT-2026-${Date.now()}${width}`;
    const name = `Disposable delete project ${width}`;
    await page.goto("/projects/new");
    await waitForHydration(page, 'ol[aria-label="Langkah wizard"]');
    await page.getByLabel("Kode project", { exact: true }).fill(code);
    await page.getByLabel("Nama project", { exact: true }).fill(name);
    await page.getByLabel("Venue", { exact: true }).fill("Test deletion venue");
    for (let step = 0; step < 4; step++) await page.getByRole("button", { name: "Lanjut →", exact: true }).click();
    await page.getByRole("button", { name: "Simpan project", exact: true }).click();
    await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
    const url = page.url();

    const managerContext = await browser.newContext({ viewport: { width, height: 900 } });
    try {
      const manager = await managerContext.newPage();
      await login(manager, "manager@ops.test");
      await manager.goto(url);
      await expect(manager.getByRole("heading", { name, exact: true })).toBeVisible();
      await expect(manager.getByRole("button", { name: "Hapus project", exact: true })).toHaveCount(0);

      await page.getByRole("button", { name: "Hapus project", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Hapus project?", exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(name, { exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await page.getByRole("button", { name: "Hapus project", exact: true }).click();
      await dialog.getByLabel("Alasan penghapusan", { exact: true }).fill("Project duplikat untuk pengujian");
      await dialog.getByLabel(/Ketik kode/).fill("WRONG-CODE");
      await dialog.getByRole("button", { name: "Ya, hapus project", exact: true }).click();
      await expect(dialog.getByRole("alert")).toHaveText("Kode konfirmasi tidak sesuai dengan kode project");
      await dialog.getByRole("button", { name: "Batal", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();

      await page.getByRole("button", { name: "Hapus project", exact: true }).click();
      await dialog.getByLabel("Alasan penghapusan", { exact: true }).fill("Project duplikat untuk pengujian");
      await dialog.getByLabel(/Ketik kode/).fill(code);
      await page.screenshot({ path: testInfo.outputPath("delete-project-dialog.png") });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await dialog.getByRole("button", { name: "Ya, hapus project", exact: true }).click();
      await expect(page).toHaveURL(/\/projects\?deleted=1$/);
      await expect(page.getByRole("status").filter({ hasText: "Project berhasil dihapus" })).toBeVisible();
      await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
      const hidden = await page.goto(url);
      expect(hidden?.status()).toBe(404);
      const hiddenDay = await page.goto(`${url}/days/${today()}/opening`);
      expect(hiddenDay?.status()).toBe(404);
      expect((await page.goto(`/issues/new?projectId=${url.split("/").at(-1)}`))?.status()).toBe(404);
      expect((await manager.goto(url))?.status()).toBe(404);
      await page.goto("/reports");
      await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(0);
      await page.goto("/admin/audit");
      const audit = page.locator("main li").filter({ hasText: code }).filter({ hasText: "project.soft_deleted" });
      await expect(audit).toHaveCount(1);
      await expect(audit).toContainText("Project duplikat untuk pengujian");
    } finally {
      await managerContext.close();
    }
  });
}
