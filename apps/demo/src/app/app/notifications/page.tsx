import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { logout } from "../../actions";

type Notification = { id: string; messageType: string; recipient: string; status: string; createdAt: Date; bookingId: string | null; customerName: string | null; serviceTitle: string | null; startsAt: Date | null };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = 'all' } = await searchParams; const { tenant, membership } = await requireTenantWorkspace();
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager) throw new Error('You do not have permission to view notification delivery.');
  await requireFeature(tenant.id, 'email-notifications'); const tenantSlug = await currentTenantRouteSlug(tenant.slug); const db = tenantDb(tenant);
  const selectedStatus = ['all', 'queued', 'sent', 'failed'].includes(status) ? status : 'all';
  const notifications = await db.unsafe<Notification[]>('SELECT eo.id,eo.message_type AS "messageType",eo.recipient,eo.status,eo.created_at AS "createdAt",eo.booking_id AS "bookingId",c.name AS "customerName",s.title AS "serviceTitle",b.starts_at AS "startsAt" FROM email_outbox eo LEFT JOIN bookings b ON b.id=eo.booking_id AND b.tenant_id=eo.tenant_id LEFT JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id LEFT JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id WHERE eo.tenant_id=$1 AND ($2=\'all\' OR eo.status=$2) ORDER BY eo.created_at DESC LIMIT 100', [tenant.id, selectedStatus]);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tenant.timezone, dateStyle: 'medium', timeStyle: 'short' });
  const path = '/' + tenantSlug + '/app/notifications';
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="notifications" /><header><div><p>NOTIFICATIONS · OUTBOX</p><h1>{tenant.name}</h1><span>Delivery state for transactional booking emails. Provider delivery is not configured in this local environment.</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Email outbox</h2><p>{notifications.length} tenant-scoped notification{notifications.length === 1 ? '' : 's'} shown. Management tokens and message payloads are intentionally not displayed.</p></div></div><nav className="waybook-list-filter" aria-label="Notification status filter">{['all', 'queued', 'sent', 'failed'].map((value) => <a key={value} href={path + '?status=' + value} aria-current={selectedStatus === value ? 'page' : undefined}>{value === 'all' ? 'All' : value[0].toUpperCase() + value.slice(1)}</a>)}</nav><div className="waybook-table-wrap"><table><thead><tr><th>Created</th><th>Type</th><th>Recipient</th><th>Booking</th><th>State</th></tr></thead><tbody>{notifications.map((notification) => <tr key={notification.id}><td>{time.format(notification.createdAt)}</td><td>{notification.messageType}</td><td>{notification.recipient}</td><td>{notification.bookingId ? <><strong>{notification.customerName ?? 'Client'}</strong><small>{notification.serviceTitle ?? 'Service'}{notification.startsAt ? ' · ' + time.format(notification.startsAt) : ''}</small></> : '—'}</td><td>{notification.status}</td></tr>)}{notifications.length === 0 ? <tr><td colSpan={5}>No {selectedStatus === 'all' ? '' : selectedStatus + ' '}notifications.</td></tr> : null}</tbody></table></div></section></main>;
}
