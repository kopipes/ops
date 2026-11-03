import { defineConfig } from "@playwright/test";

// An explicit URL is an opt-in override. Normal runs start isolated fixtures.
const externalServer = process.env.E2E_BASE_URL;
const baseURL = externalServer ?? "http://localhost:3113";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1, // tests share only the disposable E2E server/database
  webServer: externalServer ? undefined : {
    command: "node --import tsx scripts/start-e2e.ts",
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "off",
  },
});
