import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/waybook/auth";
import { controlDb, findTenantById, tenantDb } from "@/lib/waybook/database";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { logout } from "../actions";

export default async function TenantAppPage() {
  const identity = await requireIdentity();
  if (identity.isPlatformAdmin) redirect("/control");
  const memberships = await controlDb<{ tenantId: string; role: string }[]>`SELECT tenant_id AS "tenantId", role FROM tenant_memberships WHERE identity_id = ${identity.id} LIMIT 2`;
  if (memberships.length !== 1) throw new Error("This local identity must have exactly one tenant membership.");
  const tenant = await findTenantById(memberships[0].tenantId);
  if (!tenant || tenant.lifecycleStatus !== "active") throw new Error("Tenant workspace is unavailable.");
  const db = tenantDb(tenant);
  const [[settings], [customerCount], [bookingCount], [serviceCount]] = await Promise.all([
    db<{ name: string; timezone: string }[]>`SELECT name, timezone FROM tenant_settings WHERE tenant_id = ${tenant.id}`,
    db<{ count: number }[]>`SELECT count(*)::int AS count FROM customers`,
    db<{ count: number }[]>`SELECT count(*)::int AS count FROM bookings WHERE starts_at >= date_trunc('day', now())`,
    db<{ count: number }[]>`SELECT count(*)::int AS count FROM services WHERE is_active = true`,
  ]);
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantName={settings.name} active="overview" /><header><div><p>TENANT WORKSPACE · DATABASE-BACKED</p><h1>{settings.name}</h1><span>{memberships[0].role} · {settings.timezone}</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-metrics"><article><span>Bookings today</span><strong>{bookingCount.count}</strong></article><article><span>Customers</span><strong>{customerCount.count}</strong></article><article><span>Active services</span><strong>{serviceCount.count}</strong></article></section><section className="waybook-data-card"><h2>Tenant data boundary</h2><p>This workspace is resolved from the signed-in user’s single Control-plane membership. Its database connection is selected on the server from the registered tenant—not from the browser.</p></section></main>;
}
