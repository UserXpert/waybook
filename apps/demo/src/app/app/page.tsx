import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { logout } from "../actions";

export default async function TenantAppPage() {
  const { tenant, membership, isControlView } = await requireTenantWorkspace();
  const db = tenantDb(tenant);
  const [[settings], [customerCount], [bookingCount], [serviceCount]] = await Promise.all([
    db<{ name: string; timezone: string }[]>`SELECT name, timezone FROM tenant_settings WHERE tenant_id = ${tenant.id}`,
    db<{ count: number }[]>`SELECT count(*)::int AS count FROM customers`,
    db<{ count: number }[]>`SELECT count(*)::int AS count FROM bookings WHERE starts_at >= date_trunc('day', now())`,
    db<{ count: number }[]>`SELECT count(*)::int AS count FROM services WHERE is_active = true`,
  ]);
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={settings.name} active="overview" /><header><div><p>TENANT WORKSPACE · DATABASE-BACKED</p><h1>{settings.name}</h1><span>{isControlView ? "Control view · read-only" : `${membership.role} · ${settings.timezone}`}</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-metrics"><article><span>Bookings today</span><strong>{bookingCount.count}</strong></article><article><span>Customers</span><strong>{customerCount.count}</strong></article><article><span>Active services</span><strong>{serviceCount.count}</strong></article></section><section className="waybook-data-card"><h2>Tenant data boundary</h2><p>{isControlView ? "This is a read-only Control view. The tenant is resolved server-side from the registered route and database connection." : "This workspace is resolved from the signed-in user’s Control-plane membership. Its database connection is selected on the server from the registered tenant—not from the browser."}</p></section></main>;
}
