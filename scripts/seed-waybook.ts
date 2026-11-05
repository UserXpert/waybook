import { randomBytes, scryptSync } from "node:crypto";
import postgres from "postgres";

const local = (name: string) => `postgresql://waybook@127.0.0.1:5440/${name}`;
const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL ?? local("waybook_control");

function passwordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}

const seedPassword = process.env.WAYBOOK_LOCAL_PASSWORD ?? "waybook-local-only";
const control = postgres(controlUrl, { max: 1, ssl: false });

async function upsertIdentity(email: string, displayName: string, isPlatformAdmin: boolean) {
  const existing = await control<{ id: string }[]>`SELECT id FROM identities WHERE email = ${email} LIMIT 1`;
  if (existing[0]) return existing[0].id;
  const [identity] = await control<{ id: string }[]>`
    INSERT INTO identities (email, password_hash, display_name, is_platform_admin)
    VALUES (${email}, ${passwordHash(seedPassword)}, ${displayName}, ${isPlatformAdmin})
    RETURNING id
  `;
  return identity.id;
}

async function main() {
  const adminId = await upsertIdentity("admin@waybook.local", "Waybook Admin", true);
  const nordicOwnerId = await upsertIdentity("owner@nordic.local", "Sofie Andersen", false);
  const physioOwnerId = await upsertIdentity("owner@copenhagen-physio.local", "Mikkel Holm", false);

  const tenants = [
    { slug: "nordic-studio", name: "Nordic Studio", domain: "nordic.localhost", env: "WAYBOOK_NORDIC_STUDIO_DATABASE_URL", ownerId: nordicOwnerId, plan: "growth" },
    { slug: "copenhagen-physio", name: "Copenhagen Physio", domain: "copenhagen.localhost", env: "WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL", ownerId: physioOwnerId, plan: "starter" },
  ] as const;

  for (const tenant of tenants) {
    const existing = await control<{ id: string }[]>`SELECT id FROM tenants WHERE slug = ${tenant.slug} LIMIT 1`;
    const tenantId = existing[0]?.id ?? (await control<{ id: string }[]>`
      INSERT INTO tenants (slug, name, plan, lifecycle_status, database_env_key, branding)
      VALUES (${tenant.slug}, ${tenant.name}, ${tenant.plan}, 'active', ${tenant.env}, ${JSON.stringify({ accent: "#173f39" })}::jsonb)
      RETURNING id
    `)[0].id;
    await control`INSERT INTO tenant_domains (tenant_id, hostname) VALUES (${tenantId}, ${tenant.domain}) ON CONFLICT (hostname) DO NOTHING`;
    await control`INSERT INTO tenant_memberships (tenant_id, identity_id, role) VALUES (${tenantId}, ${tenant.ownerId}, 'owner') ON CONFLICT (tenant_id, identity_id) DO NOTHING`;
    await control`INSERT INTO tenant_migration_statuses (tenant_id, version, status, applied_at) VALUES (${tenantId}, '0001_operational.sql', 'healthy', now()) ON CONFLICT (tenant_id) DO UPDATE SET version = EXCLUDED.version, status = EXCLUDED.status, applied_at = EXCLUDED.applied_at, updated_at = now()`;
    await control`INSERT INTO tenant_backup_statuses (tenant_id, status, last_verified_at) VALUES (${tenantId}, 'unknown', NULL) ON CONFLICT (tenant_id) DO NOTHING`;
    await control`INSERT INTO tenant_feature_states (tenant_id, feature_key, is_enabled) SELECT ${tenantId}, feature_key, is_enabled FROM plan_feature_defaults WHERE plan = ${tenant.plan} ON CONFLICT (tenant_id, feature_key) DO NOTHING`;
    await control`INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id, metadata) VALUES (${adminId}, ${tenantId}, 'tenant.seeded', 'tenant', ${tenantId}, ${JSON.stringify({ source: "local-seed" })}::jsonb)`;

    const tenantUrl = process.env[tenant.env] ?? local(tenant.slug === "nordic-studio" ? "waybook_nordic_studio" : "waybook_copenhagen_physio");
    const tenantDb = postgres(tenantUrl, { max: 1, ssl: false });
    await tenantDb`INSERT INTO tenant_settings (tenant_id, name, timezone, currency, booking_page) VALUES (${tenantId}, ${tenant.name}, 'Europe/Copenhagen', 'DKK', ${JSON.stringify({ publicName: tenant.name })}::jsonb) ON CONFLICT (tenant_id) DO UPDATE SET name = EXCLUDED.name`;
    const owner = await tenantDb<{ id: string }[]>`SELECT id FROM team_members WHERE tenant_id = ${tenantId} AND email = ${tenant.slug === "nordic-studio" ? "sofie@nordic.local" : "mikkel@copenhagen-physio.local"} LIMIT 1`;
    const ownerEmail = tenant.slug === "nordic-studio" ? "sofie@nordic.local" : "mikkel@copenhagen-physio.local";
    const ownerName = tenant.slug === "nordic-studio" ? "Sofie Andersen" : "Mikkel Holm";
    const staffId = owner[0]?.id ?? (await tenantDb<{ id: string }[]>`INSERT INTO team_members (tenant_id, identity_id, role, name, email) VALUES (${tenantId}, ${tenant.ownerId}, 'owner', ${ownerName}, ${ownerEmail}) RETURNING id`)[0].id;
    const serviceSlug = tenant.slug === "nordic-studio" ? "studio-session" : "initial-assessment";
    const serviceTitle = tenant.slug === "nordic-studio" ? "Studio session" : "Initial physiotherapy assessment";
    const service = await tenantDb<{ id: string }[]>`SELECT id FROM services WHERE tenant_id = ${tenantId} AND slug = ${serviceSlug} LIMIT 1`;
    const serviceId = service[0]?.id ?? (await tenantDb<{ id: string }[]>`INSERT INTO services (tenant_id, slug, title, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents) VALUES (${tenantId}, ${serviceSlug}, ${serviceTitle}, 60, 10, 10, 65000) RETURNING id`)[0].id;
    await tenantDb`INSERT INTO service_team_members (tenant_id, service_id, team_member_id) VALUES (${tenantId}, ${serviceId}, ${staffId}) ON CONFLICT DO NOTHING`;
    await tenantDb`INSERT INTO availability_rules (tenant_id, team_member_id, rrule, start_time, end_time, timezone) SELECT ${tenantId}, ${staffId}, 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', '09:00', '17:00', 'Europe/Copenhagen' WHERE NOT EXISTS (SELECT 1 FROM availability_rules WHERE tenant_id = ${tenantId} AND team_member_id = ${staffId})`;
    await tenantDb.end();
  }

  await control.end();
  console.log("Waybook Control and two tenant workspaces seeded.");
  console.log("Local users: admin@waybook.local, owner@nordic.local, owner@copenhagen-physio.local");
}

main().catch(async (error: unknown) => {
  await control.end();
  console.error(error);
  process.exit(1);
});
