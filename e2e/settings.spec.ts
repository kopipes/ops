import { expect, test } from "@playwright/test";
import { waitForHydration } from "./helpers";

test("window checkboxes stay consistent after save, repeated save and reload", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("admin@ops.test");
  await page.getByLabel("Password", { exact: true }).fill("OpsDemo2026!");
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/admin/settings");
  await waitForHydration(page, 'input[name="openingWindowEnabled"]');

  const opening = page.getByLabel("Gunakan window opening", { exact: true });
  const closing = page.getByLabel("Gunakan window closing", { exact: true });
  const save = page.getByRole("button", { name: "Simpan setelan", exact: true });
  const saved = page.getByText("Setelan tersimpan.", { exact: true });

  const timeFields = ["defaultOpeningWindowStart", "defaultOpeningWindowEnd", "defaultClosingWindowStart", "defaultClosingWindowEnd"];
  const initial = {
    opening: await opening.isChecked(), closing: await closing.isChecked(),
    timezone: await page.locator('select[name="defaultTimezone"]').inputValue(),
    times: await Promise.all(timeFields.map(name => page.locator(`input[name="${name}"]`).inputValue())),
  };
  async function saveSettings() {
    const response = page.waitForResponse(result => result.request().method() === "POST" && new URL(result.url()).pathname === "/admin/settings");
    await save.click();
    await response;
    await expect(save).toBeEnabled();
  }

  try {
    // Start from a server-rendered enabled setting, matching the reported case.
    await opening.check();
    await closing.check();
    await saveSettings();
    await expect(saved).toBeVisible();
    await page.reload();
    await waitForHydration(page, 'input[name="openingWindowEnabled"]');
    await expect(opening).toBeChecked();
    await expect(closing).toBeChecked();

    await opening.uncheck();
    await closing.uncheck();
    await saveSettings();
    await expect(saved).toBeVisible();
    await expect(opening).not.toBeChecked();
    await expect(closing).not.toBeChecked();
    await expect(page.getByText("Opening bebas jam. Waktu pengisian tetap dicatat otomatis.", { exact: true })).toBeVisible();
    await expect(page.getByText("Closing bebas jam. Waktu pengisian tetap dicatat otomatis.", { exact: true })).toBeVisible();
    await expect(page.locator('input[name="defaultOpeningWindowStart"]')).toBeHidden();
    await expect(page.locator('input[name="defaultClosingWindowStart"]')).toBeHidden();

    // A second save must not accidentally submit a native-reset checkbox value.
    await saveSettings();
    await expect(save).toBeEnabled();
    await expect(opening).not.toBeChecked();
    await expect(closing).not.toBeChecked();
    await page.reload();
    await expect(opening).not.toBeChecked();
    await expect(closing).not.toBeChecked();

    await waitForHydration(page, 'input[name="openingWindowEnabled"]');
    await opening.check();
    await closing.check();
    await page.locator('input[name="defaultOpeningWindowStart"]').fill("22:00");
    await saveSettings();
    await expect(page.locator('form [role="alert"]')).toContainText("jam mulai harus sebelum jam selesai");
    await expect(opening).toBeChecked();
    await expect(closing).toBeChecked();
    await expect(page.locator('input[name="defaultOpeningWindowStart"]')).toHaveValue("22:00");
    await page.locator('input[name="defaultOpeningWindowStart"]').fill("07:15");
    await page.locator('input[name="defaultClosingWindowStart"]').fill("18:20");
    await page.locator('select[name="defaultTimezone"]').selectOption("Asia/Makassar");
    await saveSettings();
    await expect(saved).toBeVisible();
    await expect(opening).toBeChecked();
    await expect(closing).toBeChecked();
    await expect(page.locator('input[name="defaultOpeningWindowStart"]')).toHaveValue("07:15");
    await expect(page.locator('input[name="defaultClosingWindowStart"]')).toHaveValue("18:20");
    await expect(page.locator('select[name="defaultTimezone"]')).toHaveValue("Asia/Makassar");
    await page.reload();
    await expect(opening).toBeChecked();
    await expect(closing).toBeChecked();
    await expect(page.locator('input[name="defaultOpeningWindowStart"]')).toHaveValue("07:15");
    await expect(page.locator('input[name="defaultClosingWindowStart"]')).toHaveValue("18:20");
    await expect(page.locator('select[name="defaultTimezone"]')).toHaveValue("Asia/Makassar");
  } finally {
    // Restore clocks while enabled, then restore the original global switches.
    await page.reload();
    await waitForHydration(page, 'input[name="openingWindowEnabled"]');
    await opening.check();
    await closing.check();
    for (const [index, name] of timeFields.entries()) {
      await page.locator(`input[name="${name}"]`).fill(initial.times[index]);
    }
    await page.locator('select[name="defaultTimezone"]').selectOption(initial.timezone);
    await saveSettings();
    await page.reload();
    await waitForHydration(page, 'input[name="openingWindowEnabled"]');
    await opening.setChecked(initial.opening);
    await closing.setChecked(initial.closing);
    await saveSettings();
  }

});
