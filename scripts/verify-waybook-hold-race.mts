import assert from "node:assert/strict";
import postgres from "postgres";

// This test creates a real hold. Use only a disposable local server/database
// seeded with the dedicated one-staff service below; it never cleans up data.
const databaseUrl = process.env.WAYBOOK_LOCAL_PERF_DB_URL;
const appUrl = process.env.WAYBOOK_ISOLATED_APP_URL;
const localHosts = ["localhost", "127.0.0.1", "::1", "[::1]"];
if (!databaseUrl || !appUrl) throw new Error("Set WAYBOOK_LOCAL_PERF_DB_URL and WAYBOOK_ISOLATED_APP_URL to disposable local fixtures.");
const dbAddress = new URL(databaseUrl), appAddress = new URL(appUrl);
if (!localHosts.includes(dbAddress.hostname) || !localHosts.includes(appAddress.hostname) || !/^(perf_|waybook_test_)/.test(dbAddress.pathname.slice(1))) {
  throw new Error("The app and a perf_/waybook_test_ database must both be local.");
}
const service = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const db = postgres(databaseUrl, { max: 1, ssl: false });
const forceOverlap = process.env.WAYBOOK_TEST_FORCE_HOLD_RACE === "1";
try {
  const [fixture] = await db<{ locationId: string; slug: string }[]>`
    SELECT sl.location_id AS "locationId",s.slug FROM service_locations sl
    JOIN services s ON s.id=sl.service_id AND s.tenant_id=sl.tenant_id
    WHERE sl.service_id=${service} LIMIT 1`;
  assert.equal(fixture?.slug, "isolated-concurrency-test", "dedicated synthetic race fixture missing");
  const start = new Date(Date.now() + 2 * 86_400_000), end = new Date(Date.now() + 5 * 86_400_000);
  const params = new URLSearchParams({ service, location: fixture.locationId, start: start.toISOString(), end: end.toISOString() });
  const availabilityResponse = await fetch(new URL(`/nordic/api/public/availability?${params}`, appAddress));
  assert.equal(availabilityResponse.status, 200, "synthetic availability failed");
  const availability = await availabilityResponse.json() as { availability: Array<{ teamMemberId: string; slots: Array<{ startTime: string; endTime: string }> }> };
  assert.equal(availability.availability.length, 1, "fixture must have exactly one eligible staff member");
  const provider = availability.availability[0], slot = provider.slots[0];
  assert.ok(slot, "no synthetic slot available");
  if (forceOverlap) {
    // Keep the first synthetic insert open long enough for the other requests
    // to reach it. This trigger is installed only in the isolated test DB.
    await db.unsafe(`CREATE OR REPLACE FUNCTION waybook_test_hold_delay() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF EXISTS (SELECT 1 FROM service_team_members WHERE service_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' AND team_member_id = NEW.team_member_id)
        THEN PERFORM pg_sleep(0.15); END IF;
        RETURN NEW;
      END $$`);
    await db.unsafe("CREATE TRIGGER waybook_test_hold_delay BEFORE INSERT ON booking_blocks FOR EACH ROW EXECUTE FUNCTION waybook_test_hold_delay()");
  }
  const payload = { serviceId: service, locationId: fixture.locationId, startsAt: slot.startTime, endsAt: slot.endTime };
  const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(new URL("/nordic/api/public/holds", appAddress), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  })));
  const statuses = responses.map((response) => response.status).sort();
  assert.equal(statuses.filter((status) => status === 201).length, 1, `expected one hold: ${statuses}`);
  assert.ok(statuses.every((status) => status === 201 || status === 409), `unexpected responses: ${statuses}`);
  const [count] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM booking_blocks WHERE team_member_id=${provider.teamMemberId} AND starts_at=${slot.startTime} AND ends_at=${slot.endTime} AND state='held'`;
  assert.equal(count.n, 1, "expected exactly one active hold in the isolated database");
  console.log(`Eight concurrent requests${forceOverlap ? " with delayed inserts" : ""}: ${statuses.join(", ")}; exactly one active hold.`);
} finally {
  if (forceOverlap) {
    await db.unsafe("DROP TRIGGER IF EXISTS waybook_test_hold_delay ON booking_blocks");
    await db.unsafe("DROP FUNCTION IF EXISTS waybook_test_hold_delay()");
  }
  await db.end();
}
