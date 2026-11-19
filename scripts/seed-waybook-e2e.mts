import postgres from "postgres";

// Add deterministic booking assignments only to explicitly named local CI databases.
const targets = [process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL, process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL];
for (const raw of targets) {
  if (!raw) throw new Error("Missing Waybook E2E database URL.");
  const url = new URL(raw);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) {
    throw new Error("Waybook E2E seeding requires a local waybook_e2e_ database.");
  }
}
for (const raw of targets) {
  const db = postgres(raw!, { max: 1, ssl: false });
  try {
    await db.begin(async tx => {
      await tx`INSERT INTO locations (tenant_id, slug, name, timezone)
        SELECT tenant_id, 'primary', name, timezone FROM tenant_settings ON CONFLICT (tenant_id, slug) DO NOTHING`;
      await tx`INSERT INTO location_hours (tenant_id, location_id, day_of_week, start_time, end_time)
        SELECT l.tenant_id, l.id, day::smallint, '09:00', '17:00' FROM locations l CROSS JOIN generate_series(0, 6) day
        WHERE l.slug='primary' AND NOT EXISTS (SELECT 1 FROM location_hours h WHERE h.location_id=l.id AND h.day_of_week=day::smallint)`;
      await tx`INSERT INTO team_member_locations (tenant_id, team_member_id, location_id)
        SELECT t.tenant_id, t.id, l.id FROM team_members t JOIN locations l ON l.tenant_id=t.tenant_id AND l.slug='primary' ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO service_locations (tenant_id, service_id, location_id)
        SELECT s.tenant_id, s.id, l.id FROM services s JOIN locations l ON l.tenant_id=s.tenant_id AND l.slug='primary' ON CONFLICT DO NOTHING`;
      await tx`UPDATE availability_rules SET rrule='FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR,SA,SU'`;
      if (url.pathname === "/waybook_e2e_nordic") {
        const [settings] = await tx<{ tenantId: string; timezone: string }[]>`SELECT tenant_id AS "tenantId",timezone FROM tenant_settings LIMIT 1`;
        const [location] = await tx<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id=${settings.tenantId} AND slug='primary' LIMIT 1`;
        const [member] = await tx<{ id: string }[]>`SELECT id FROM team_members WHERE tenant_id=${settings.tenantId} ORDER BY created_at LIMIT 1`;
        const [service] = await tx<{ id: string; durationMinutes: number }[]>`SELECT id,duration_minutes AS "durationMinutes" FROM services WHERE tenant_id=${settings.tenantId} ORDER BY created_at LIMIT 1`;
        for (const hour of [13, 14]) {
          const key = `e2e-month-calendar-${hour}`;
          const [existing] = await tx<{ id: string }[]>`SELECT id FROM bookings WHERE tenant_id=${settings.tenantId} AND idempotency_key=${key} LIMIT 1`;
          if (existing) continue;
          const email = `month-calendar-${hour}@example.test`;
          const [customer] = await tx<{ id: string }[]>`SELECT id FROM customers WHERE tenant_id=${settings.tenantId} AND email=${email} LIMIT 1`;
          const customerId = customer?.id ?? (await tx<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email) VALUES (${settings.tenantId},${`Monthly calendar ${hour}`},${email}) RETURNING id`)[0].id;
          const [slot] = await tx<{ startsAt: Date; endsAt: Date }[]>`SELECT (((now() AT TIME ZONE ${settings.timezone})::date + 10 + ${`${hour}:00`}::time) AT TIME ZONE ${settings.timezone}) AS "startsAt", ((((now() AT TIME ZONE ${settings.timezone})::date + 10 + ${`${hour}:00`}::time) AT TIME ZONE ${settings.timezone}) + ${service.durationMinutes} * interval '1 minute') AS "endsAt"`;
          const [block] = await tx<{ id: string }[]>`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state) VALUES (${settings.tenantId},${member.id},${location.id},${slot.startsAt},${slot.endsAt},'confirmed') RETURNING id`;
          await tx`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,idempotency_key,booked_price_cents) VALUES (${settings.tenantId},${block.id},${service.id},${member.id},${location.id},${customerId},${slot.startsAt},${slot.endsAt},'confirmed','tenant',${key},0)`;
        }
      }
    });
  } finally { await db.end(); }
}
console.log("Waybook E2E booking assignments seeded.");
