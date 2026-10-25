import fs from "node:fs";
import { defineConfig } from "@playwright/test";
import { WEB_ORIGIN } from "./e2e/real/env";

// The specs read this to pick the real-API helpers; the config is loaded in every worker, so set it here.
process.env.E2E_API = "real";
const preinstalled = "/opt/pw-browsers/chromium";
const executablePath = process.env.PW_CHROMIUM ?? (fs.existsSync(preinstalled) ? preinstalled : undefined);

/**
 * Real NestJS API on real Postgres (database cq_web_e2e, created and dropped by e2e/real/global-setup.ts).
 * Runs the same smoke and a11y specs as playwright.config.ts plus e2e/real/*.spec.ts.
 * DATABASE_URL: an admin URL whose role may create databases (default postgresql://cq:cq@localhost:5432/cq_dev;
 * only its server is used, never its database).
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  globalSetup: "./e2e/real/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "test-results-real.json" }]],
  use: {
    baseURL: WEB_ORIGIN,
    launchOptions: executablePath ? { executablePath } : {},
    trace: "retain-on-failure",
  },
});
