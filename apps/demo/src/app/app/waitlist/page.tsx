import { TableDateFields } from "@/components/table-date-fields";
import { dateFilterParams, dateRangeWhere, tableDateFilters, tableDateOrder, type TableDateParams } from "@/lib/waybook/table-date-filters";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";
import { WaitlistForm, WaitlistStatusForm } from "@/components/waitlist-forms";
import { tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { canManageAppointment, staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { logout } from "../../actions";

type Entry = { id: string; status: string; customerId: string; serviceId: string; locationId: string; eligibleTeamMemberId: string | null; customerName: string; customerEmail: string; serviceTitle: string; locationName: string; staffName: string | null; preferredLocalDate: string | null; preferredStartTime: string | null; preferredEndTime: string | null; createdAt: Date };

const statusLabel = (status: string) => ({ waiting: 'Waiting', offered: 'Offer sent', booked: 'Booked', cancelled: 'Cancelled' }[status] ?? status);

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ status?: string; add?: string } & TableDateParams> }) {
  const { status = 'waiting', add, sort, from, to } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  const permissions = await staffPermissionContext(tenant, membership);
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  if (!await isFeatureEnabled(tenant.id, 'calendars')) redirect(tenantPath(tenantSlug, '/app'));
  const canManage = permissions.isManager || permissions.canManageWaitlist;
  if (!canManage) notFound();
  const terminology = await getTenantTerminology(tenant);
  const clientLabel = titleTerminology(terminology.client);
  const db = tenantDb(tenant);
  const chosenStatus = ['waiting', 'offered', 'booked', 'cancelled', 'all'].includes(status) ? status : 'waiting';
  const dates = tableDateFilters({ sort, from, to }, tenant.timezone);
  const entries = await db<Entry[]>`SELECT w.id,w.status,w.customer_id AS "customerId",w.service_id AS "serviceId",w.location_id AS "locationId",eligible.id AS "eligibleTeamMemberId",c.name AS "customerName",c.email AS "customerEmail",s.title AS "serviceTitle",l.name AS "locationName",tm.name AS "staffName",w.preferred_local_date::text AS "preferredLocalDate",w.preferred_start_time::text AS "preferredStartTime",w.preferred_end_time::text AS "preferredEndTime",w.created_at AS "createdAt" FROM waitlist_entries w JOIN customers c ON c.id=w.customer_id AND c.tenant_id=w.tenant_id JOIN services s ON s.id=w.service_id AND s.tenant_id=w.tenant_id JOIN locations l ON l.id=w.location_id AND l.tenant_id=w.tenant_id LEFT JOIN team_members tm ON tm.id=w.preferred_team_member_id AND tm.tenant_id=w.tenant_id LEFT JOIN LATERAL (SELECT candidate.id FROM team_members candidate JOIN team_member_locations tml ON tml.team_member_id=candidate.id AND tml.tenant_id=candidate.tenant_id JOIN service_team_members stm ON stm.team_member_id=candidate.id AND stm.tenant_id=candidate.tenant_id WHERE candidate.tenant_id=w.tenant_id AND candidate.is_active=TRUE AND tml.location_id=w.location_id AND stm.service_id=w.service_id ORDER BY (candidate.id=w.preferred_team_member_id) DESC,candidate.name LIMIT 1) eligible ON TRUE WHERE w.tenant_id=${tenant.id} AND ${chosenStatus === 'all' ? db`TRUE` : db`w.status=${chosenStatus}`}
    ${dateRangeWhere(db, "w.preferred_local_date", dates, true)}
    ORDER BY ${tableDateOrder(db, "w.preferred_local_date", "w.id", { sort: dates.sort, today: dates.todayKey }, true)}
  `;
  const path = tenantPath(tenantSlug, '/app/waitlist');
  const listHref = (value: string, adding = false) => {
    const params = dateFilterParams(new URLSearchParams(), dates);
    if (value !== "waiting") params.set("status", value);
    if (adding) params.set("add", "1");
    return params.size ? `${path}?${params}` : path;
  };
  const filterHref = listHref(chosenStatus);
  const addHref = listHref(chosenStatus, true);
  const formOpen = add === '1';
  const entryLabel = chosenStatus === 'all' ? 'entry' : statusLabel(chosenStatus).toLowerCase() + ' entry';
  const entryCountLabel = entries.length === 1 ? entryLabel : entryLabel.replace(/entry$/, 'entries');
  const calendarHrefFor = (entry: Entry) => {
    if (!entry.eligibleTeamMemberId || ['booked', 'cancelled'].includes(entry.status)) return null;
    if (!canManageAppointment(permissions, entry.eligibleTeamMemberId)) return null;
    if (!permissions.isManager && !permissions.canViewTeamCalendar && entry.eligibleTeamMemberId !== permissions.teamMemberId) return null;
    const week = weekStartForLocalDate(entry.preferredLocalDate ?? tenantDateKey(new Date(), tenant.timezone));
    const params = new URLSearchParams({ location: entry.locationId, employee: entry.eligibleTeamMemberId, service: entry.serviceId, waitlist: entry.id, week, view: 'staff' });
    return `${tenantPath(tenantSlug, '/app/calendars')}?${params.toString()}`;
  };
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="waitlist" /><header><div><p>WAITLIST · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>Capture demand and track the next step when a desired slot is unavailable.</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Waitlist</h2><p>{entries.length} {entryCountLabel} shown.</p></div>{canManage ? <Link className="waybook-primary-link" href={addHref} scroll={false}>Add {terminology.client}</Link> : null}</div><nav className="waybook-list-filter waitlist-filter" aria-label="Waitlist status filter">{['waiting', 'offered', 'booked', 'cancelled', 'all'].map((value) => <Link key={value} href={listHref(value)} aria-current={chosenStatus === value ? 'page' : undefined}>{value === 'all' ? 'All' : statusLabel(value)}</Link>)}</nav><form method="get" className="waybook-list-filter dated-list-filters"><input type="hidden" name="status" value={chosenStatus} /><TableDateFields dates={dates} label="Preferred date range" /><button type="submit">Apply</button></form><div className="waybook-table-wrap"><table><thead><tr><th>{clientLabel}</th><th>Request</th><th>Preference</th><th>Added</th>{canManage ? <th>Next step</th> : null}</tr></thead><tbody>{entries.map((entry) => { const calendarHref = calendarHrefFor(entry); const timeWindow = entry.preferredStartTime && entry.preferredEndTime ? `${entry.preferredStartTime.slice(0, 5)}–${entry.preferredEndTime.slice(0, 5)}` : null; return <tr key={entry.id}><td><strong>{entry.customerName}</strong><small>{entry.customerEmail}</small></td><td><strong>{entry.serviceTitle}</strong><small>{entry.locationName}{entry.staffName ? ' · ' + entry.staffName : ''}</small></td><td>{entry.preferredLocalDate ?? (timeWindow ? 'Any date' : 'Flexible')}{timeWindow ? <small>{timeWindow}</small> : null}</td><td>{entry.createdAt.toLocaleDateString('en-GB', { timeZone: tenant.timezone })}<small>{statusLabel(entry.status)}</small></td>{canManage ? <td>{calendarHref ? <Link className="waybook-row-link waitlist-find-slot" href={calendarHref}>Find a slot</Link> : null}<WaitlistStatusForm entryId={entry.id} status={entry.status} /></td> : null}</tr>; })}{entries.length === 0 ? <tr><td colSpan={canManage ? 5 : 4}>No {chosenStatus === 'all' ? '' : statusLabel(chosenStatus).toLowerCase() + ' '}waitlist entries.</td></tr> : null}</tbody></table></div></section>{formOpen ? <TenantEditorDialog title={`Add ${terminology.client} to waitlist`} closeHref={filterHref}><aside className="tenant-drawer appointment-drawer" aria-label={`Add ${terminology.client} to waitlist`}><header><div><p>WAITLIST</p><h2>Add {terminology.client}</h2><span>Record their preferences so the team can respond when capacity opens.</span></div><TenantEditorClose label="Close waitlist entry" href={filterHref}>×</TenantEditorClose></header><div className="appointment-drawer__body">{canManage ? <WaitlistForm terminology={terminology} canCreateClient={permissions.isManager || permissions.canManageClients} canSearchPhone={permissions.isManager || permissions.canViewClients || permissions.canManageClients} /> : <p className="tenant-drawer-note">Read-only access: waitlist entries require an owner or manager.</p>}</div></aside></TenantEditorDialog> : null}</main>;
}
