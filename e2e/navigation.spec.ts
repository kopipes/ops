import { expect, test } from "@playwright/test";

for (const width of [390, 1440]) {
  test(`navigation retains the current page while loading at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill("manager@ops.test");
    await page.getByLabel("Password", { exact: true }).fill("OpsDemo2026!");
    await page.getByRole("button", { name: "Masuk", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Manager Event", exact: true })).toBeVisible();

    let release!: () => void;
    let intercepted!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const request = new Promise<void>(resolve => { intercepted = resolve; });
    const match = (url: URL) => url.pathname === "/projects" && url.searchParams.has("_rsc");
    await page.route(match, async route => { intercepted(); await gate; await route.continue(); });
    const nav = width < 1024 ? page.getByRole("navigation", { name: "Navigasi utama", exact: true }) : page.locator("aside");
    const link = nav.getByRole("link", { name: "Project", exact: true });
    try {
      await link.click({ noWaitAfter: true });
      await request;
      await expect(link).toHaveAttribute("aria-busy", "true");
      await expect(page.getByRole("heading", { name: "Manager Event", exact: true })).toBeVisible();
      await expect(page.getByText("Memuat halaman…", { exact: true })).toHaveCount(0);
      release();
      await expect(page.getByRole("heading", { name: "Project", exact: true })).toBeVisible();
    } finally {
      release();
      await page.unroute(match);
    }
    await nav.getByRole("link", { name: "Issues", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Issues", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Project", exact: true })).toBeVisible();
  });
}
