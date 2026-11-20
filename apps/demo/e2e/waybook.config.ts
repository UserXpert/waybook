import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const requiredDatabases = ["WAYBOOK_CONTROL_DATABASE_URL", "WAYBOOK_NORDIC_STUDIO_DATABASE_URL", "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL"] as const;
for (const name of requiredDatabases) {
  const raw = process.env[name];
  if (!raw) throw new Error(`Waybook E2E requires ${name} to target a disposable local waybook_e2e_ database.`);
  const database = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(database.hostname) || !database.pathname.startsWith("/waybook_e2e_")) {
    throw new Error(`Waybook E2E requires ${name} to target a disposable local waybook_e2e_ database.`);
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
    // Production builds deliberately require an explicit signing key. Give
    // only the local, disposable E2E server a deterministic key so signed
    // embed hand-offs can be exercised without a deployment secret.
    env: { ...process.env, WAYBOOK_EMBED_SIGNING_SECRET: process.env.WAYBOOK_EMBED_SIGNING_SECRET ?? "waybook-e2e-embed-secret" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
