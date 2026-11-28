import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function requireDisposableLocalDatabase(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for Waybook E2E tests.`);
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/waybook_e2e_')) {
    throw new Error(`${name} must target a disposable local waybook_e2e_ database.`);
  }
}

for (const name of ["WAYBOOK_CONTROL_DATABASE_URL", "WAYBOOK_NORDIC_STUDIO_DATABASE_URL", "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL"]) requireDisposableLocalDatabase(name);

export default defineConfig({
  testDir: "./waybook-tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  maxFailures: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  timeout: 45_000,
  use: { baseURL: "http://localhost:3336", trace: "on-first-retry", screenshot: "only-on-failure", timezoneId: "Europe/Copenhagen", ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH } } : {}) },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      grep: /@mobile\b/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "../../node_modules/.bin/next start -p 3336",
    port: 3336,
    cwd: path.resolve(here, ".."),
    env: {
      WAYBOOK_EMBED_SIGNING_SECRET: process.env.WAYBOOK_EMBED_SIGNING_SECRET ?? "waybook-e2e-embed-secret",
      GOOGLE_CLIENT_ID: "waybook-e2e-google-client",
      GOOGLE_CLIENT_SECRET: "waybook-e2e-google-secret",
      BETTER_AUTH_SECRET: "waybook-e2e-google-fixture-signing-key",
      BETTER_AUTH_URL: "http://localhost:3336",
      WAYBOOK_STRIPE_SANDBOX_SECRET_KEY: "sk_test_waybookE2EFixture",
      WAYBOOK_STRIPE_SANDBOX_ORIGIN: "http://localhost:3336",
      WAYBOOK_STRIPE_SANDBOX_WEBHOOK_SECRET: "whsec_waybookE2EFixture",
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import ${JSON.stringify(path.join(here, "fixtures/google-oauth.mjs"))} --import ${JSON.stringify(path.join(here, "fixtures/stripe-connect.mjs"))}`.trim(),
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
