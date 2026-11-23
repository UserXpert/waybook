import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";

// This verifier creates real holds. Use only a disposable local server/database
// seeded with an active location and public service; it creates and removes its own rows.
const databaseUrl = process.env.WAYBOOK_LOCAL_PERF_DB_URL;
const appUrl = process.env.WAYBOOK_ISOLATED_APP_URL;
const localHosts = ["localhost", "127.0.0.1", "::1", "[::1]"];
if (!databaseUrl || !appUrl) throw new Error("Set WAYBOOK_LOCAL_PERF_DB_URL and WAYBOOK_ISOLATED_APP_URL to disposable local fixtures.");
const dbAddress = new URL(databaseUrl), appAddress = new URL(appUrl);
if (!localHosts.includes(dbAddress.hostname) || !localHosts.includes(appAddress.hostname) || !/^(perf_|waybook_(?:test|e2e)_)/.test(dbAddress.pathname.slice(1))) {
  throw new Error("The app and a perf_, waybook_test_, or waybook_e2e_ database must both be local.");
}
const db = postgres(databaseUrl, { max: 1, ssl: false });
const forceOverlap = process.env.WAYBOOK_TEST_FORCE_HOLD_RACE === "1";
const tenantRoute = process.env.WAYBOOK_TEST_TENANT_ROUTE ?? "nordic";
const fixtureTenantId = process.env.WAYBOOK_TEST_TENANT_ID ?? "";
const fixtureLocationId = process.env.WAYBOOK_TEST_LOCATION_ID ?? "";
const preflightServiceId = process.env.WAYBOOK_TEST_PREFLIGHT_SERVICE_ID ?? "";
if (!fixtureTenantId || !fixtureLocationId || !preflightServiceId) throw new Error("Set WAYBOOK_TEST_TENANT_ID, WAYBOOK_TEST_LOCATION_ID, and WAYBOOK_TEST_PREFLIGHT_SERVICE_ID for the disposable fixture.");
const runId = randomUUID();
const service = randomUUID();
const member = randomUUID();
const functionName = `wb_hold_delay_f_${runId.replaceAll("-", "")}`;
const triggerName = `wb_hold_delay_t_${runId.replaceAll("-", "")}`;
let functionInstalled = false;
let delayInstalled = false;
try {
  const preflight = new URL(`/${tenantRoute}/api/public/availability`, appAddress);
  preflight.search = new URLSearchParams({ service: preflightServiceId, location: fixtureLocationId, start: new Date(Date.now() + 2 * 86_400_000).toISOString(), end: new Date(Date.now() + 3 * 86_400_000).toISOString() }).toString();
  assert.equal((await fetch(preflight)).status, 200, "fixture route must resolve before creating test data");
  const [seed] = await db<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id=${fixtureTenantId} AND id=${fixtureLocationId} AND is_active=TRUE AND is_online_bookable=TRUE`;
  if (!seed) throw new Error("explicit fixture location must be active, online, and belong to the explicit tenant");
  await db.begin(async (tx) => {
    await tx`INSERT INTO services (id,tenant_id,slug,title,duration_minutes,price_cents,is_active) VALUES (${service},${fixtureTenantId},${`isolated-concurrency-${runId}`},'Isolated concurrency test',60,0,TRUE)`;
    await tx`INSERT INTO team_members (id,tenant_id,role,name,email,is_active) VALUES (${member},${fixtureTenantId},'staff','Isolated verifier',${`isolated-verifier-${runId}@example.test`},TRUE)`;
    await tx`INSERT INTO service_locations (tenant_id,service_id,location_id) VALUES (${fixtureTenantId},${service},${fixtureLocationId})`;
    await tx`INSERT INTO service_team_members (tenant_id,service_id,team_member_id) VALUES (${fixtureTenantId},${service},${member})`;
    await tx`INSERT INTO team_member_locations (tenant_id,team_member_id,location_id) VALUES (${fixtureTenantId},${member},${fixtureLocationId})`;
    await tx`INSERT INTO availability_rules (tenant_id,team_member_id,rrule,start_time,end_time,timezone) VALUES (${fixtureTenantId},${member},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','17:00','Europe/Copenhagen')`;
  });
  const fixture = { locationId: fixtureLocationId };
  const start = new Date(Date.now() + 2 * 86_400_000), end = new Date(Date.now() + 5 * 86_400_000);
  const params = new URLSearchParams({ service, location: fixture.locationId, start: start.toISOString(), end: end.toISOString() });
  const availabilityResponse = await fetch(new URL(`/${tenantRoute}/api/public/availability?${params}`, appAddress));
  assert.equal(availabilityResponse.status, 200, "synthetic availability failed");
  const availability = await availabilityResponse.json() as { availability: Array<{ teamMemberId: string; slots: Array<{ startTime: string; endTime: string }> }> };
  assert.equal(availability.availability.length, 1, "fixture must have exactly one eligible staff member");
  const provider = availability.availability[0], slot = provider.slots[0];
  assert.ok(slot, "no synthetic slot available");
  if (forceOverlap) {
    // Keep the first synthetic insert open long enough for the other requests
    // to reach it. This trigger is installed only in the isolated test DB.
    await db.unsafe(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.team_member_id = '${member}'::uuid
        THEN PERFORM pg_sleep(0.15); END IF;
        RETURN NEW;
      END $$`);
    functionInstalled = true;
    await db.unsafe(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON booking_blocks FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
    delayInstalled = true;
  }
  const payload = { serviceId: service, locationId: fixture.locationId, startsAt: slot.startTime, endsAt: slot.endTime };
  const responses = await Promise.all(Array.from({ length: 8 }, () => fetch(new URL(`/${tenantRoute}/api/public/holds`, appAddress), {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  })));
  const statuses = responses.map((response) => response.status).sort();
  assert.equal(statuses.filter((status) => status === 201).length, 1, `expected one hold: ${statuses}`);
  assert.ok(statuses.every((status) => status === 201 || status === 409), `unexpected responses: ${statuses}`);
  const winner = responses.find((response) => response.status === 201);
  if (!winner) throw new Error("one request must create a hold");
  const held = await winner.json() as { holdId: string };
  assert.ok(held.holdId, "hold response must include an ID");
  const [created] = await db<{ id: string; tenantId: string }[]>`SELECT booking_block_id AS id,tenant_id AS "tenantId" FROM booking_holds WHERE id=${held.holdId}`;
  const blockId = created?.id;
  assert.ok(blockId, "hold must reference a booking block");
  assert.equal(created?.tenantId, fixtureTenantId, "HTTP app must create the hold in this disposable fixture tenant");
  const [count] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM booking_blocks WHERE team_member_id=${provider.teamMemberId} AND starts_at=${slot.startTime} AND ends_at=${slot.endTime} AND state='held'`;
  assert.equal(count.n, 1, "expected exactly one active hold in the isolated database");

  // Expiry is applied by the supported availability lifecycle. An expired hold
  // must no longer reserve the slot and confirmation must never create a booking.
  await db`UPDATE booking_blocks SET expires_at=now() - interval '1 second' WHERE id=${blockId}`;
  await db`UPDATE booking_holds SET expires_at=now() - interval '1 second' WHERE id=${held.holdId}`;
  const releasedResponse = await fetch(new URL(`/${tenantRoute}/api/public/availability?${params}`, appAddress));
  assert.equal(releasedResponse.status, 200, "availability refresh after expiry failed");
  const released = await releasedResponse.json() as { availability: Array<{ teamMemberId: string; slots: Array<{ startTime: string; endTime: string }> }> };
  assert.ok(released.availability.find((item) => item.teamMemberId === provider.teamMemberId)?.slots.some((item) => item.startTime === slot.startTime && item.endTime === slot.endTime), "expired hold must release the slot");
  const confirmation = await fetch(new URL(`/${tenantRoute}/api/public/confirmations`, appAddress), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ holdId: held.holdId, idempotencyKey: "hold-expiry-verifier", customer: { name: "Verifier", email: "verifier@example.test" } }),
  });
  assert.equal(confirmation.status, 409, "expired hold confirmation must be rejected");
  const [bookings] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM bookings WHERE hold_id=${held.holdId}`;
  assert.equal(bookings.n, 0, "expired hold must not create a booking");
  console.log(`Eight concurrent requests${forceOverlap ? " with delayed inserts" : ""}: ${statuses.join(", ")}; expired hold released and rejected at confirmation.`);
} finally {
  if (delayInstalled) {
    await db.unsafe(`DROP TRIGGER IF EXISTS ${triggerName} ON booking_blocks`);
  }
  if (functionInstalled) {
    await db.unsafe(`DROP FUNCTION IF EXISTS ${functionName}()`);
  }
  if (fixtureTenantId) {
    await db`DELETE FROM booking_holds WHERE tenant_id=${fixtureTenantId} AND booking_block_id IN (SELECT id FROM booking_blocks WHERE tenant_id=${fixtureTenantId} AND team_member_id=${member})`;
    await db`DELETE FROM booking_blocks WHERE tenant_id=${fixtureTenantId} AND team_member_id=${member}`;
    await db`DELETE FROM availability_rules WHERE tenant_id=${fixtureTenantId} AND team_member_id=${member}`;
    await db`DELETE FROM team_member_locations WHERE tenant_id=${fixtureTenantId} AND team_member_id=${member}`;
    await db`DELETE FROM service_team_members WHERE tenant_id=${fixtureTenantId} AND service_id=${service}`;
    await db`DELETE FROM service_locations WHERE tenant_id=${fixtureTenantId} AND service_id=${service}`;
    await db`DELETE FROM team_members WHERE tenant_id=${fixtureTenantId} AND id=${member}`;
    await db`DELETE FROM services WHERE tenant_id=${fixtureTenantId} AND id=${service}`;
  }
  await db.end();
}
