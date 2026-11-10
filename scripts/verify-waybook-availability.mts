import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import postgres from "postgres";

// The production module is server-only. Resolve that marker to an empty module
// for this local Node integration check; application imports remain unchanged.
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === "server-only" ? { url: "data:text/javascript,export{}", shortCircuit: true } : nextResolve(specifier, context);
} });

const url = process.env.WAYBOOK_LOCAL_PERF_DB_URL;
if (!url || !["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Set WAYBOOK_LOCAL_PERF_DB_URL to a local PostgreSQL database.");
const { availableSlots } = await import("../apps/demo/src/lib/waybook/booking.ts");
const db = postgres(url, { max: 1, ssl: false });
try {
  await db.begin(async (tx) => {
    for (const sql of [
      "CREATE TEMP TABLE locations (id uuid, tenant_id uuid, timezone text, is_active bool, is_online_bookable bool, slug text) ON COMMIT DROP",
      "CREATE TEMP TABLE location_hours (tenant_id uuid, location_id uuid, day_of_week int, start_time text, end_time text) ON COMMIT DROP",
      "CREATE TEMP TABLE location_closed_dates (tenant_id uuid, location_id uuid, local_date date) ON COMMIT DROP",
      "CREATE TEMP TABLE services (id uuid, tenant_id uuid, slug text, duration_minutes int, is_active bool) ON COMMIT DROP",
      "CREATE TEMP TABLE team_members (id uuid, tenant_id uuid, is_active bool) ON COMMIT DROP",
      "CREATE TEMP TABLE service_team_members (team_member_id uuid, tenant_id uuid, service_id uuid) ON COMMIT DROP",
      "CREATE TEMP TABLE team_member_locations (team_member_id uuid, tenant_id uuid, location_id uuid) ON COMMIT DROP",
      "CREATE TEMP TABLE service_locations (service_id uuid, tenant_id uuid, location_id uuid) ON COMMIT DROP",
      "CREATE TEMP TABLE availability_rules (tenant_id uuid, team_member_id uuid, rrule text, start_time text, end_time text, timezone text, valid_from date, valid_until date) ON COMMIT DROP",
      "CREATE TEMP TABLE availability_overrides (tenant_id uuid, team_member_id uuid, local_date date, start_time text, end_time text, is_unavailable bool) ON COMMIT DROP",
      "CREATE TEMP TABLE booking_blocks (id uuid, tenant_id uuid, team_member_id uuid, starts_at timestamptz, ends_at timestamptz, state text, expires_at timestamptz) ON COMMIT DROP",
    ]) await tx.unsafe(sql);
    const t="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002", l="10000000-0000-4000-8000-000000000001", s="20000000-0000-4000-8000-000000000001", a="30000000-0000-4000-8000-000000000001", b="30000000-0000-4000-8000-000000000002", block="40000000-0000-4000-8000-000000000001";
    const day = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const nextDay = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    const laterDay = new Date(Date.parse(`${day}T00:00:00Z`) + 8 * 86_400_000).toISOString().slice(0, 10);
    await tx`INSERT INTO locations VALUES (${l},${t},'Europe/Copenhagen',true,true,'primary')`;
    await tx`INSERT INTO location_hours SELECT ${t}::uuid,${l}::uuid,n,'09:00','17:00' FROM generate_series(0,6) n`;
    await tx`INSERT INTO services VALUES (${s},${t},'test',60,true)`;
    await tx`INSERT INTO service_locations VALUES (${s},${t},${l})`;
    for (const m of [a,b]) {
      await tx`INSERT INTO team_members VALUES (${m},${t},true)`;
      await tx`INSERT INTO service_team_members VALUES (${m},${t},${s})`;
      await tx`INSERT INTO team_member_locations VALUES (${m},${t},${l})`;
      await tx`INSERT INTO availability_rules VALUES (${t},${m},'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU','09:00','17:00','Europe/Copenhagen',NULL,NULL)`;
    }
    await tx`INSERT INTO availability_overrides VALUES (${t},${a},${day}::date,'12:00','13:00',true),(${other},${b},${day}::date,NULL,NULL,true),(${t},${a},${laterDay}::date,'09:00','17:00',false)`;
    await tx`INSERT INTO booking_blocks VALUES (${block},${t},${a},${`${day}T09:00:00Z`},${`${day}T10:00:00Z`},'confirmed',NULL),('40000000-0000-4000-8000-000000000002',${other},${b},${`${day}T09:00:00Z`},${`${day}T10:00:00Z`},'confirmed',NULL)`;
    const tenant = { id:t, slug:"test", name:"Test", timezone:"Europe/Copenhagen", databaseEnvKey:"TEST", lifecycleStatus:"active" };
    const start = new Date(`${day}T00:00:00Z`), end = new Date(`${nextDay}T00:00:00Z`);
    const run = (excludeBookingBlockId?: string) => availableSlots(tenant,s,start,end,{ locationId:l, slotInterval:30, excludeBookingBlockId },tx as never);
    const occupied = await run(), excluded = await run(block);
    const member = occupied.find((item) => item.teamMemberId === a)!;
    const rescheduled = excluded.find((item) => item.teamMemberId === a)!;
    assert.equal(occupied.length,2);
    assert.ok(occupied.every((p) => p.slots.every((slot) => new Date(slot.startTime) >= start && new Date(slot.endTime) <= end)));
    assert.ok(!member.slots.some((slot) => slot.startTime === `${day}T09:00:00.000Z`));
    assert.ok(rescheduled.slots.some((slot) => slot.startTime === `${day}T09:00:00.000Z`));
    assert.ok(occupied.find((item) => item.teamMemberId === b)!.slots.some((slot) => slot.startTime === `${day}T09:00:00.000Z`), "other tenant must not block this staff member");
    await tx`UPDATE locations SET timezone='Pacific/Kiritimati' WHERE id=${l}`;
    await tx`UPDATE availability_rules SET timezone='Pacific/Kiritimati' WHERE tenant_id=${t}`;
    await tx`INSERT INTO location_closed_dates VALUES (${t},${l},${nextDay}::date)`;
    await tx`INSERT INTO availability_overrides VALUES (${t},${a},${nextDay}::date,'09:00','17:00',false)`;
    const eastStart = new Date(`${day}T12:00:00Z`), eastEnd = new Date(`${day}T23:59:59Z`);
    const closed = await availableSlots({...tenant, timezone:"Pacific/Kiritimati"},s,eastStart,eastEnd,{locationId:l,slotInterval:30},tx as never);
    assert.equal(closed.length, 2);
    assert.ok(closed.every((p) => p.slots.length === 0), "local closed date must block UTC-day slots");
    await tx`DELETE FROM location_closed_dates WHERE tenant_id=${t} AND location_id=${l}`;
    const open = await availableSlots({...tenant, timezone:"Pacific/Kiritimati"},s,eastStart,eastEnd,{locationId:l,slotInterval:30},tx as never);
    assert.ok(open.some((p) => p.slots.length > 0), "fixture must have slots when the local date is open");
    console.log("Availability range, staff isolation, occupied/excluded blocks and local-date closure passed.");
  });
} finally { await db.end(); }
