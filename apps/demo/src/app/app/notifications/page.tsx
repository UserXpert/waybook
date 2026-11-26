import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffAccessRequests } from "@/components/staff-access-requests";
import { TableDateFields } from "@/components/table-date-fields";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { arrivalAlertsEnabled, canReceiveArrivalAlerts, providerArrivalInbox } from "@/lib/waybook/provider-arrival-alerts";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { dateRangeWhere, tableDateFilters, tableDateOrder, type TableDateParams } from "@/lib/waybook/table-date-filters";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { markArrivalAlertRead, saveArrivalAlertsSetting } from "./actions";

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<TableDateParams> }) {
  const { tenant, membership } = await requireTenantWorkspace();
  const db = tenantDb(tenant);
  const [terms, permissions, tenantSlug, calendarsEnabled, identity] = await Promise.all([
    getTenantTerminology(tenant),
    staffPermissionContext(tenant, membership),
    currentTenantRouteSlug(tenant.slug),
    isFeatureEnabled(tenant.id, "calendars"),
    requireIdentity(),
  ]);
  const [alertsEnabled, showInbox] = await Promise.all([
    permissions.isManager && calendarsEnabled && arrivalAlertsEnabled(db, tenant.id),
    calendarsEnabled && membership.role !== "read-only" && (permissions.isManager || Boolean(permissions.teamMemberId)) &&
      canReceiveArrivalAlerts(db, tenant.id, identity.id),
  ]);
  if (!permissions.isManager && !showInbox) notFound();
  const dates = tableDateFilters(await searchParams, tenant.timezone);
  const [arrivals, overdueArrivals] = await Promise.all([
    showInbox ? db<{ id: string; customerName: string; notifiedAt: Date; unread: boolean }[]>`
      SELECT b.id, client.name AS "customerName", max(alert.notified_at) AS "notifiedAt", bool_or(alert.read_at IS NULL) AS unread
      ${providerArrivalInbox(db, tenant.id, identity.id)}
      GROUP BY b.id, client.name ORDER BY "notifiedAt" DESC, b.id LIMIT 100
    ` : [],
    permissions.isManager ? db<{ id: string; customerName: string; serviceTitle: string; startsAt: Date; teamMemberId: string | null; locationId: string | null }[]>`
      SELECT b.id, c.name AS "customerName", s.title AS "serviceTitle", b.starts_at AS "startsAt",
        b.team_member_id AS "teamMemberId", b.location_id AS "locationId"
      FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      WHERE b.tenant_id = ${tenant.id} AND b.status = 'arrived' AND b.ends_at <= now()
        ${dateRangeWhere(db, "b.starts_at", dates)}
      ORDER BY ${tableDateOrder(db, "b.starts_at", "b.id", dates)} LIMIT 100
    ` : [],
  ]);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const calendarHref = tenantPath(tenantSlug, "/app/calendars");
  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="notifications" />
    {membership.role === "owner" && await isFeatureEnabled(tenant.id, "team") ? <StaffAccessRequests tenant={tenant} /> : null}
    {showInbox ? <section className="waybook-data-card" aria-labelledby="provider-alerts-heading">
      <div className="waybook-section-heading"><h2 id="provider-alerts-heading">Waiting room alerts</h2></div>
      {arrivals.length ? <ul className="provider-alert-list" role="list">
        {arrivals.map((arrival) => <li key={arrival.id}>
          <div><strong>{arrival.customerName}</strong><small>Waiting for you</small></div>
          <time dateTime={arrival.notifiedAt.toISOString()}>{time.format(arrival.notifiedAt)}</time>
          <div className="provider-alert-actions">
            <Link className="waybook-action" href={`${calendarHref}?booking=${arrival.id}`}>Open appointment</Link>
            {arrival.unread ? <form action={markArrivalAlertRead}>
              <input type="hidden" name="bookingId" value={arrival.id} />
              <button type="submit" className="waybook-action waybook-action--secondary">Mark as read</button>
            </form> : <small>Read</small>}
          </div>
        </li>)}
      </ul> : <p>No waiting room alerts.</p>}
    </section> : null}
    {permissions.isManager && calendarsEnabled ? <section className="waybook-data-card">
      <div className="waybook-section-heading"><div>
        <h2>Waiting room settings</h2>
        <p>Let the front desk send in-app alerts to the providers assigned to an appointment.</p>
      </div></div>
      <form key={String(alertsEnabled)} action={saveArrivalAlertsSetting} className="provider-alert-actions">
        <label className="staff-status-toggle"><input type="checkbox" role="switch" name="providerAlerts" defaultChecked={alertsEnabled} />
          <span aria-hidden="true" /><b>Enable provider alerts</b>
        </label>
        <button type="submit" className="waybook-action">Save settings</button>
      </form>
    </section> : null}
    {permissions.isManager ? <section className="waybook-data-card">
      <div className="waybook-section-heading"><div>
        <h2>Appointments needing review</h2>
        <p>These {terms.clients} were marked arrived, but their appointments have ended. Review the booking and update its status.</p>
      </div></div>
      <form method="get" className="waybook-list-filter dated-list-filters">
        <TableDateFields dates={dates} label="Appointment date range" /><button type="submit">Apply</button>
      </form>
      {overdueArrivals.length ? <div className="waybook-table-wrap"><table>
        <thead><tr><th>{titleTerminology(terms.client)}</th><th>Appointment</th><th>Action</th></tr></thead>
        <tbody>{overdueArrivals.map((booking) => {
          const day = tenantDateKey(booking.startsAt, tenant.timezone);
          const params = new URLSearchParams({
            booking: booking.id, day, week: weekStartForLocalDate(day),
            ...(booking.teamMemberId ? { employee: booking.teamMemberId } : {}),
            ...(booking.locationId ? { location: booking.locationId } : {}),
          });
          return <tr key={booking.id}>
            <td>{booking.customerName}</td><td>{booking.serviceTitle}<small>{time.format(booking.startsAt)}</small></td>
            <td><Link className="waybook-row-link" href={`${calendarHref}?${params}`}>Review booking</Link></td>
          </tr>;
        })}</tbody>
      </table></div> : <p>No appointments need review.</p>}
    </section> : null}
  </main>;
}
