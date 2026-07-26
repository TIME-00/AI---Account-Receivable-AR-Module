import { defineConfig, devices } from "@playwright/test";

const baseURL =
  process.env.PLAYWRIGHT_BASE_URL ??
  "https://account-receivable-module.vercel.app";

const storageState =
  process.env.PLAYWRIGHT_STORAGE_STATE ??
  "playwright/.auth/demo-finance.prod.json";

const isLocalRun =
  baseURL === "http://127.0.0.1:3100" ||
  baseURL === "http://localhost:3100";

export default defineConfig({
  testDir: "./e2e",

  fullyParallel: false,
  workers: 1,

  timeout: 60_000,

  expect: {
    timeout: 10_000,
  },

  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,

  reporter: [
    ["list"],
    ["html", { open: "never" }],
  ],

  outputDir: "test-results",

  webServer: isLocalRun
    ? {
        command:
          "npm.cmd run dev -- --hostname 127.0.0.1 --port 3100",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: true,
        timeout: 120_000,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,

  use: {
    baseURL,
    storageState,

    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 5"],
      },
    },
  ],
});