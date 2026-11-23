import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const run = promisify(execFile);
const workspace = fileURLToPath(new URL("../../../../", import.meta.url));

test("competing holds reserve one slot and expiry prevents stale confirmation", async ({ baseURL }) => {
  const database = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL!;
  const db = postgres(database, { max: 1, ssl: false });
  try {
    const [fixture] = await db<{ tenantId: string; locationId: string; serviceId: string }[]>`
      SELECT s.tenant_id AS "tenantId", l.id AS "locationId", s.id AS "serviceId"
      FROM services s
      JOIN service_locations sl ON sl.tenant_id=s.tenant_id AND sl.service_id=s.id
      JOIN locations l ON l.tenant_id=sl.tenant_id AND l.id=sl.location_id
      WHERE s.slug='studio-session' AND s.is_active AND l.slug='primary' AND l.is_active AND l.is_online_bookable
    `;
    expect(fixture, "expected the seeded public service and location").toBeDefined();
    await run(process.execPath, ["--import", "tsx", "scripts/verify-waybook-hold-race.mts"], {
      cwd: workspace,
      timeout: 30_000,
      env: {
        ...process.env,
        WAYBOOK_LOCAL_PERF_DB_URL: database,
        WAYBOOK_ISOLATED_APP_URL: baseURL,
        WAYBOOK_TEST_TENANT_ROUTE: "nordic",
        WAYBOOK_TEST_TENANT_ID: fixture!.tenantId,
        WAYBOOK_TEST_LOCATION_ID: fixture!.locationId,
        WAYBOOK_TEST_PREFLIGHT_SERVICE_ID: fixture!.serviceId,
        WAYBOOK_TEST_FORCE_HOLD_RACE: "1",
      },
    });
  } finally {
    await db.end();
  }
});
