import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireIdentity } from "@/lib/waybook/auth";
import { controlDb, tenantDb, type TenantRecord } from "@/lib/waybook/database";
import { tenantFeatures, type TenantFeatureState } from "@/lib/waybook/features";
import { tenantDashboardHref } from "@/lib/waybook/tenant-dashboard-link";
import { routeSlugFromHostname } from "@/lib/waybook/tenant-routes";
import { ControlTenantManager, type ControlTenantRow } from "./control-tenant-manager";
import { logout } from "../actions";

type ControlTenant = TenantRecord & { plan: string; migrationStatus: string; backupStatus: string; hostname: string };

export default async function ControlPage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: selectedTenantId } = await searchParams;
  const requestHeaders = await headers();
  const requestHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3333";
  const identity = await requireIdentity();
  if (!identity.isPlatformAdmin) redirect("/");
  const tenants = await controlDb<ControlTenant[]>`
    SELECT t.id, t.slug, t.name, t.plan, t.lifecycle_status AS "lifecycleStatus", t.database_env_key AS "databaseEnvKey", t.timezone, d.hostname,
      COALESCE(m.status, 'pending') AS "migrationStatus", COALESCE(b.status, 'unknown') AS "backupStatus"
    FROM tenants t JOIN tenant_domains d ON d.tenant_id = t.id AND d.is_primary = true
    LEFT JOIN tenant_migration_statuses m ON m.tenant_id = t.id LEFT JOIN tenant_backup_statuses b ON b.tenant_id = t.id
    ORDER BY t.name
  `;
  const rows: ControlTenantRow[] = await Promise.all(tenants.map(async (tenant) => {
    const db = tenantDb(tenant);
    const [bookings, staff, features] = await Promise.all([
      db<{ count: number }[]>`SELECT count(*)::int AS count FROM bookings WHERE starts_at >= date_trunc('week', now())`,
      db<{ count: number }[]>`SELECT count(*)::int AS count FROM team_members WHERE is_active = true`,
      tenantFeatures(tenant.id),
    ]);
    const routeSlug = routeSlugFromHostname(tenant.hostname, tenant.slug);
    return { ...tenant, routeSlug, bookingCount: bookings.count, staffCount: staff.count, features: features as TenantFeatureState[], workspaceHref: tenantDashboardHref(requestHost, routeSlug) };
  }));
  return <main className="waybook-data-page"><header><div><p>WAYBOOK CONTROL · DATABASE-BACKED</p><h1>Tenant operations</h1><span>Signed in as {identity.displayName}</span></div><form action={logout}><button>Sign out</button></form></header><ControlTenantManager tenants={rows} selectedTenantId={selectedTenantId} /></main>;
}
