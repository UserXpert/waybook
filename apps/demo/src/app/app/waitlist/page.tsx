import Link from "next/link";
import { redirect } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { WaitlistForm, WaitlistStatusForm } from "@/components/waitlist-forms";
import { tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { logout } from "../../actions";

type Entry = { id: string; status: string; customerId: string; serviceId: string; locationId: string; eligibleTeamMemberId: string | null; customerName: string; customerEmail: string; serviceTitle: string; locationName: string; staffName: string | null; preferredLocalDate: string | null; preferredStartTime: string | null; preferredEndTime: string | null; notes: string | null; createdAt: Date };

const statusLabel = (status: string) => ({ waiting: 'Waiting', offered: 'Offer sent', booked: 'Booked', cancelled: 'Cancelled' }[status] ?? status);

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ status?: string; add?: string }> }) {
  const { status = 'waiting', add } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  const permissions = await staffPermissionContext(tenant, membership);
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  if (!await isFeatureEnabled(tenant.id, 'calendars')) redirect(tenantPath(tenantSlug, '/app'));
  const db = tenantDb(tenant); const canManage = permissions.isManager || permissions.canManageWaitlist;
  if (!canManage) throw new Error('You do not have permission to manage the waitlist.');
  const chosenStatus = ['waiting', 'offered', 'booked', 'cancelled', 'all'].includes(status) ? status : 'waiting';
  const [entries] = await Promise.all([
    db.unsafe<Entry[]>('SELECT w.id,w.status,w.customer_id AS "customerId",w.service_id AS "serviceId",w.location_id AS "locationId",eligible.id AS "eligibleTeamMemberId",c.name AS "customerName",c.email AS "customerEmail",s.title AS "serviceTitle",l.name AS "locationName",tm.name AS "staffName",w.preferred_local_date::text AS "preferredLocalDate",w.preferred_start_time::text AS "preferredStartTime",w.preferred_end_time::text AS "preferredEndTime",w.notes,w.created_at AS "createdAt" FROM waitlist_entries w JOIN customers c ON c.id=w.customer_id AND c.tenant_id=w.tenant_id JOIN services s ON s.id=w.service_id AND s.tenant_id=w.tenant_id JOIN locations l ON l.id=w.location_id AND l.tenant_id=w.tenant_id LEFT JOIN team_members tm ON tm.id=w.preferred_team_member_id AND tm.tenant_id=w.tenant_id LEFT JOIN LATERAL (SELECT candidate.id FROM team_members candidate JOIN team_member_locations tml ON tml.team_member_id=candidate.id AND tml.tenant_id=candidate.tenant_id JOIN service_team_members stm ON stm.team_member_id=candidate.id AND stm.tenant_id=candidate.tenant_id WHERE candidate.tenant_id=w.tenant_id AND candidate.is_active=TRUE AND tml.location_id=w.location_id AND stm.service_id=w.service_id ORDER BY (candidate.id=w.preferred_team_member_id) DESC,candidate.name LIMIT 1) eligible ON TRUE WHERE w.tenant_id=$1 AND ($2=\'all\' OR w.status=$2) ORDER BY CASE w.status WHEN \'waiting\' THEN 1 WHEN \'offered\' THEN 2 WHEN \'booked\' THEN 3 ELSE 4 END, w.created_at ASC', [tenant.id, chosenStatus]),
  ]);
  const path = tenantPath(tenantSlug, '/app/waitlist'); const formOpen = add === '1';
  const entryLabel = chosenStatus === 'all' ? 'entry' : statusLabel(chosenStatus).toLowerCase() + ' entry';
  const entryCountLabel = entries.length === 1 ? entryLabel : entryLabel.replace(/entry$/, 'entries');
  const calendarHrefFor = (entry: Entry) => {
    if (!entry.eligibleTeamMemberId || ['booked', 'cancelled'].includes(entry.status)) return null;
    const week = weekStartForLocalDate(entry.preferredLocalDate ?? tenantDateKey(new Date(), tenant.timezone));
    const params = new URLSearchParams({ location: entry.locationId, employee: entry.eligibleTeamMemberId, service: entry.serviceId, customer: entry.customerId, week, view: 'staff' });
    return `${tenantPath(tenantSlug, '/app/calendars')}?${params.toString()}`;
  };
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="waitlist" /><header><div><p>WAITLIST · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>Capture demand and track the next step when a desired slot is unavailable.</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Waitlist</h2><p>{entries.length} {entryCountLabel} shown.</p></div>{canManage ? <Link className="waybook-primary-link" href={path + '?add=1'}>Add client</Link> : null}</div><nav className="waybook-list-filter waitlist-filter" aria-label="Waitlist status filter">{['waiting', 'offered', 'booked', 'cancelled', 'all'].map((value) => <Link key={value} href={path + '?status=' + value} aria-current={chosenStatus === value ? 'page' : undefined}>{value === 'all' ? 'All' : statusLabel(value)}</Link>)}</nav><div className="waybook-table-wrap"><table><thead><tr><th>Client</th><th>Request</th><th>Preference</th><th>Added</th>{canManage ? <th>Next step</th> : null}</tr></thead><tbody>{entries.map((entry) => { const calendarHref = calendarHrefFor(entry); return <tr key={entry.id}><td><strong>{entry.customerName}</strong><small>{entry.customerEmail}</small></td><td><strong>{entry.serviceTitle}</strong><small>{entry.locationName}{entry.staffName ? ' · ' + entry.staffName : ''}</small>{entry.notes ? <small>{entry.notes}</small> : null}</td><td>{entry.preferredLocalDate ? <>{entry.preferredLocalDate}<small>{entry.preferredStartTime + '–' + entry.preferredEndTime}</small></> : 'Flexible'}</td><td>{entry.createdAt.toLocaleDateString('en-GB', { timeZone: tenant.timezone })}<small>{statusLabel(entry.status)}</small></td>{canManage ? <td>{calendarHref ? <Link className="waybook-row-link waitlist-find-slot" href={calendarHref}>Find a slot</Link> : null}<WaitlistStatusForm entryId={entry.id} status={entry.status} /></td> : null}</tr>; })}{entries.length === 0 ? <tr><td colSpan={canManage ? 5 : 4}>No {chosenStatus === 'all' ? '' : statusLabel(chosenStatus).toLowerCase() + ' '}waitlist entries.</td></tr> : null}</tbody></table></div></section>{formOpen ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" aria-label="Close waitlist entry" href={path} /><aside className="tenant-drawer appointment-drawer" aria-label="Add client to waitlist"><header><div><p>WAITLIST</p><h2>Add client</h2><span>Record their preferences so the team can respond when capacity opens.</span></div><Link className="tenant-drawer-close" aria-label="Close waitlist entry" href={path}>×</Link></header><div className="appointment-drawer__body">{canManage ? <WaitlistForm /> : <p className="tenant-drawer-note">Read-only access: waitlist entries require an owner or manager.</p>}</div></aside></div> : null}</main>;
}
