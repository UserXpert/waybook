import { redirect } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { logout } from "../../actions";

type BookingRow = { id: string; startsAt: Date; endsAt: Date; status: string; source: string; customerName: string; customerEmail: string; serviceTitle: string; teamMemberName: string | null };

export default async function BookingsPage() {
  const identity = await requireIdentity();
  if (identity.isPlatformAdmin) redirect("/control");
  const { tenant } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const bookings = await tenantDb(tenant)<BookingRow[]>`
    SELECT b.id, b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.source,
      c.name AS "customerName", c.email AS "customerEmail", s.title AS "serviceTitle", tm.name AS "teamMemberName"
    FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN team_members tm ON tm.id = b.team_member_id AND tm.tenant_id = b.tenant_id
    WHERE b.tenant_id = ${tenant.id} ORDER BY b.starts_at DESC LIMIT 100
  `;
  const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="bookings" /><header><div><p>BOOKINGS · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>{bookings.length} latest booking{bookings.length === 1 ? "" : "s"} · {tenant.timezone}</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-card"><h2>Booking operations</h2><p>Every row is a persisted booking from this tenant database. The schedule is displayed in the tenant’s configured timezone.</p><div className="waybook-table-wrap"><table><thead><tr><th>When</th><th>Client</th><th>Service</th><th>Employee</th><th>Source</th><th>Status</th></tr></thead><tbody>{bookings.map((booking) => <tr key={booking.id}><td>{dateTime.format(booking.startsAt)}<small>Ends {new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, timeStyle: "short" }).format(booking.endsAt)}</small></td><td>{booking.customerName}<small>{booking.customerEmail}</small></td><td>{booking.serviceTitle}</td><td>{booking.teamMemberName ?? "Unassigned"}</td><td>{booking.source}</td><td>{booking.status}</td></tr>)}{bookings.length === 0 ? <tr><td colSpan={6}>No bookings yet.</td></tr> : null}</tbody></table></div></section></main>;
}
