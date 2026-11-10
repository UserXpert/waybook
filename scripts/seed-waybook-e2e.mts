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
    });
  } finally { await db.end(); }
}
console.log("Waybook E2E booking assignments seeded.");
