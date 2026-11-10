import Link from "next/link";
import { notFound } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { tenantPath } from "@/lib/waybook/tenant-routes";


export default async function NotificationsPage() {
  const { tenant, membership } = await requireTenantWorkspace();
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager) notFound();
  const tenantSlug = await currentTenantRouteSlug(tenant.slug); const db = tenantDb(tenant);
  const overdueArrivals = await db.unsafe<Array<{ id: string; customerName: string; serviceTitle: string; startsAt: Date; teamMemberId: string | null; locationId: string | null }>>(`SELECT b.id,c.name AS "customerName",s.title AS "serviceTitle",b.starts_at AS "startsAt",b.team_member_id AS "teamMemberId",b.location_id AS "locationId" FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id WHERE b.tenant_id=$1 AND b.status='arrived' AND b.ends_at <= now() ORDER BY b.ends_at DESC LIMIT 100`, [tenant.id]);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, dateStyle: 'medium', timeStyle: 'short' });
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="notifications" /><section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Appointments needing review</h2><p>These clients were marked arrived, but their appointments have ended. Review the booking and update its status.</p></div></div>{overdueArrivals.length ? <div className="waybook-table-wrap"><table><thead><tr><th>Client</th><th>Appointment</th><th>Action</th></tr></thead><tbody>{overdueArrivals.map((booking) => { const day = tenantDateKey(booking.startsAt, tenant.timezone); const params = new URLSearchParams({ booking: booking.id, day, week: weekStartForLocalDate(day), ...(booking.teamMemberId ? { employee: booking.teamMemberId } : {}), ...(booking.locationId ? { location: booking.locationId } : {}) }); return <tr key={booking.id}><td>{booking.customerName}</td><td>{booking.serviceTitle}<small>{time.format(booking.startsAt)}</small></td><td><Link className="waybook-row-link" href={`${tenantPath(tenantSlug, '/app/calendars')}?${params}`}>Review booking</Link></td></tr>; })}</tbody></table></div> : <p>No appointments need review.</p>}</section></main>;
}
