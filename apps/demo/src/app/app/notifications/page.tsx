import { TableDateFields } from "@/components/table-date-fields";
import { dateRangeWhere, tableDateFilters, tableDateOrder, type TableDateParams } from "@/lib/waybook/table-date-filters";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { StaffAccessRequests } from "@/components/staff-access-requests";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { tenantPath } from "@/lib/waybook/tenant-routes";


export default async function NotificationsPage({ searchParams }: { searchParams: Promise<TableDateParams> }) {
  const { tenant, membership } = await requireTenantWorkspace();
  const terms = await getTenantTerminology(tenant);
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager) notFound();
  const tenantSlug = await currentTenantRouteSlug(tenant.slug); const db = tenantDb(tenant);
  const dates = tableDateFilters(await searchParams, tenant.timezone);
  const overdueArrivals = await db<Array<{ id: string; customerName: string; serviceTitle: string; startsAt: Date; teamMemberId: string | null; locationId: string | null }>>`SELECT b.id,c.name AS "customerName",s.title AS "serviceTitle",b.starts_at AS "startsAt",b.team_member_id AS "teamMemberId",b.location_id AS "locationId" FROM bookings b JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id WHERE b.tenant_id=${tenant.id} AND b.status='arrived' AND b.ends_at <= now() ${dateRangeWhere(db, "b.starts_at", dates)} ORDER BY ${tableDateOrder(db, "b.starts_at", "b.id", dates)} LIMIT 100`;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, dateStyle: 'medium', timeStyle: 'short' });
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="notifications" />{membership.role === "owner" && await isFeatureEnabled(tenant.id, "team") ? <StaffAccessRequests tenant={tenant} /> : null}<section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Appointments needing review</h2><p>These {terms.clients} were marked arrived, but their appointments have ended. Review the booking and update its status.</p></div></div><form method="get" className="waybook-list-filter dated-list-filters"><TableDateFields dates={dates} label="Appointment date range" /><button type="submit">Apply</button></form>{overdueArrivals.length ? <div className="waybook-table-wrap"><table><thead><tr><th>{titleTerminology(terms.client)}</th><th>Appointment</th><th>Action</th></tr></thead><tbody>{overdueArrivals.map((booking) => { const day = tenantDateKey(booking.startsAt, tenant.timezone); const params = new URLSearchParams({ booking: booking.id, day, week: weekStartForLocalDate(day), ...(booking.teamMemberId ? { employee: booking.teamMemberId } : {}), ...(booking.locationId ? { location: booking.locationId } : {}) }); return <tr key={booking.id}><td>{booking.customerName}</td><td>{booking.serviceTitle}<small>{time.format(booking.startsAt)}</small></td><td><Link className="waybook-row-link" href={`${tenantPath(tenantSlug, '/app/calendars')}?${params}`}>Review booking</Link></td></tr>; })}</tbody></table></div> : <p>No appointments need review.</p>}</section></main>;
}
