import fs from "node:fs";
import { defineConfig } from "@playwright/test";

const WEB = 3100;
const API = 3101;
// Chromium is pre-installed in this environment; do not download another.
const preinstalled = "/opt/pw-browsers/chromium";
const executablePath = process.env.PW_CHROMIUM ?? (fs.existsSync(preinstalled) ? preinstalled : undefined);

export default defineConfig({
  testDir: "e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1, // one fake API, shared state
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB}`,
    launchOptions: executablePath ? { executablePath } : {},
    trace: "retain-on-failure",
  },
  webServer: [
    { command: `node e2e/fake-api.mjs ${API}`, port: API, reuseExistingServer: !!process.env.PW_REUSE },
    {
      command: `pnpm build && pnpm exec next start -p ${WEB}`,
      port: WEB,
      timeout: 240_000,
      reuseExistingServer: !!process.env.PW_REUSE,
      env: { API_URL: `http://127.0.0.1:${API}` },
    },
  ],
});
