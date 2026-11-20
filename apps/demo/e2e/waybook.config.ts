import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

for (const key of [
  "WAYBOOK_CONTROL_DATABASE_URL",
  "WAYBOOK_NORDIC_STUDIO_DATABASE_URL",
  "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL",
]) {
  const raw = process.env[key];
  if (!raw) throw new Error(`${key} is required for local Playwright verification.`);
  const url = new URL(raw);
  if (![["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname), url.pathname.startsWith("/waybook_e2e_")].every(Boolean)) {
    throw new Error(`${key} must point to a loopback waybook_e2e_ database for Playwright.`);
  }
}

export default defineConfig({
  testDir: "./waybook-tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  use: { baseURL: "http://localhost:3336", trace: "on-first-retry", screenshot: "only-on-failure", timezoneId: "Europe/Copenhagen", ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } } : {}) },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "../../node_modules/.bin/next start -p 3336",
    port: 3336,
    cwd: path.resolve(here, ".."),
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
