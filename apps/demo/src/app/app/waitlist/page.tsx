import { ListFilterOptions } from "@/components/workspace-options";
import { TableDateFields } from "@/components/table-date-fields";
import { hasTableDateFilters, dateFilterParams, dateRangeWhere, tableDateFilters, tableDateOrder, type TableDateParams } from "@/lib/waybook/table-date-filters";
import Link from "next/link";
import { CalendarDays, CalendarPlus, ListPlus } from "lucide-react";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { notFound, redirect } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";
import { WaitlistForm, WaitlistStatusForm } from "@/components/waitlist-forms";
import { staffAvailableSlots } from "@/lib/waybook/booking";
import { tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { canManageAppointment, staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";

type Entry = { id: string; status: string; customerId: string; serviceId: string; locationId: string; eligibleTeamMemberId: string | null; preferredTeamMemberId: string | null; customerName: string; customerEmail: string; serviceTitle: string; locationName: string; staffName: string | null; preferredLocalDate: string | null; preferredStartTime: string | null; preferredEndTime: string | null; createdAt: Date };

const statuses = ["waiting", "offered", "booked", "cancelled", "all"] as const;
const statusTone: Record<string, string> = {
  offered: "waybook-status-badge--warning",
  booked: "waybook-status-badge--success",
};
const statusLabel = (status: string) => ({ waiting: 'Waiting', offered: 'Offer sent', booked: 'Booked', cancelled: 'Cancelled' }[status] ?? status);

export default async function WaitlistPage({ searchParams }: { searchParams: Promise<{ status?: string; add?: string; openings?: string } & TableDateParams> }) {
  const { status = 'waiting', add, openings, sort, from, to } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  const permissions = await staffPermissionContext(tenant, membership);
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  if (!await isFeatureEnabled(tenant.id, 'calendars')) redirect(tenantPath(tenantSlug, '/app'));
  const canManage = permissions.isManager || permissions.canManageWaitlist;
  if (!canManage) notFound();
  const terminology = await getTenantTerminology(tenant);
  const clientLabel = titleTerminology(terminology.client);
  const db = tenantDb(tenant);
  const chosenStatus = statuses.some(value => value === status) ? status : 'waiting';
  const dates = tableDateFilters({ sort, from, to }, tenant.timezone);
  const entries = await db<Entry[]>`
    SELECT w.id,w.status,w.customer_id AS "customerId",w.service_id AS "serviceId",w.location_id AS "locationId",eligible.id AS "eligibleTeamMemberId",w.preferred_team_member_id AS "preferredTeamMemberId",c.name AS "customerName",c.email AS "customerEmail",s.title AS "serviceTitle",l.name AS "locationName",tm.name AS "staffName",w.preferred_local_date::text AS "preferredLocalDate",w.preferred_start_time::text AS "preferredStartTime",w.preferred_end_time::text AS "preferredEndTime",w.created_at AS "createdAt"
    FROM waitlist_entries w
    JOIN customers c ON c.id=w.customer_id AND c.tenant_id=w.tenant_id
    JOIN services s ON s.id=w.service_id AND s.tenant_id=w.tenant_id
    JOIN locations l ON l.id=w.location_id AND l.tenant_id=w.tenant_id
    LEFT JOIN team_members tm ON tm.id=w.preferred_team_member_id AND tm.tenant_id=w.tenant_id
    LEFT JOIN LATERAL (
      SELECT candidate.id FROM team_members candidate
      JOIN team_member_locations tml ON tml.team_member_id=candidate.id AND tml.tenant_id=candidate.tenant_id
      JOIN service_team_members stm ON stm.team_member_id=candidate.id AND stm.tenant_id=candidate.tenant_id
      WHERE candidate.tenant_id=w.tenant_id AND candidate.is_active AND s.is_active AND l.is_active AND l.is_online_bookable
        AND (${permissions.isManager || (permissions.canViewTeamCalendar && permissions.canManageTeamAppointments)}
          OR (candidate.id=${permissions.teamMemberId ?? null} AND ${permissions.canManageOwnAppointments || permissions.canManageTeamAppointments}))
        AND tml.location_id=w.location_id AND stm.service_id=w.service_id
      ORDER BY (candidate.id=w.preferred_team_member_id) DESC,candidate.name,candidate.id LIMIT 1
    ) eligible ON TRUE
    WHERE w.tenant_id=${tenant.id} AND ${chosenStatus === 'all' ? db`TRUE` : db`w.status=${chosenStatus}`}
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
  const now = new Date();
  const today = tenantDateKey(now, tenant.timezone);
  const canBookStaff = (id: string) => canManageAppointment(permissions, id)
    && (permissions.isManager || permissions.canViewTeamCalendar || id === permissions.teamMemberId);
  const calendarHrefFor = (entry: Entry, staffId = entry.eligibleTeamMemberId, startsAt?: string) => {
    if (!staffId || !canBookStaff(staffId) || !["waiting", "offered"].includes(entry.status)) return null;
    const date = startsAt?.slice(0, 10) ?? entry.preferredLocalDate ?? today;
    const params = new URLSearchParams({
      location: entry.locationId, employee: staffId, service: entry.serviceId, waitlist: entry.id,
      day: date, week: weekStartForLocalDate(date), view: "staff",
    });
    if (startsAt) params.set("create", startsAt);
    return `${tenantPath(tenantSlug, "/app/calendars")}?${params}`;
  };
  const requestedEntry = entries.find((entry) => entry.id === openings && calendarHrefFor(entry));
  const openingSlots = await (async () => {
    if (!requestedEntry) return [];
    const date = requestedEntry.preferredLocalDate ?? today;
    if (date < today) return [];
    const endDay = new Date(`${date}T12:00:00Z`);
    endDay.setUTCDate(endDay.getUTCDate() + (requestedEntry.preferredLocalDate ? 1 : 7));
    const start = fromZonedTime(`${date}T00:00:00`, tenant.timezone);
    const end = fromZonedTime(`${endDay.toISOString().slice(0, 10)}T00:00:00`, tenant.timezone);
    const candidates = await staffAvailableSlots(tenant, requestedEntry.serviceId, start, end, {
      locationId: requestedEntry.locationId, slotInterval: 30,
    });
    return candidates.filter(({ teamMemberId }) => canBookStaff(teamMemberId)
      && (!requestedEntry.preferredTeamMemberId || requestedEntry.preferredTeamMemberId === teamMemberId))
      .flatMap(({ teamMemberId, slots }) => slots.flatMap((slot) => {
        const startsAt = formatInTimeZone(slot.startTime, tenant.timezone, "yyyy-MM-dd'T'HH:mm");
        const endsAt = formatInTimeZone(slot.endTime, tenant.timezone, "yyyy-MM-dd'T'HH:mm");
        if (new Date(slot.startTime) < now || fromZonedTime(startsAt, tenant.timezone).getTime() !== new Date(slot.startTime).getTime()) return [];
        if (requestedEntry.preferredStartTime && requestedEntry.preferredEndTime && (
          startsAt.slice(0, 10) !== endsAt.slice(0, 10)
          || startsAt.slice(11) < requestedEntry.preferredStartTime.slice(0, 5)
          || endsAt.slice(11) > requestedEntry.preferredEndTime.slice(0, 5)
        )) return [];
        const href = calendarHrefFor(requestedEntry, teamMemberId, startsAt);
        return href ? [{ teamMemberId, href, startTime: slot.startTime, endTime: slot.endTime }] : [];
      }))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .slice(0, 3);
  })();
  const openingNames = openingSlots.length ? await db<{ id: string; name: string }[]>`
    SELECT id, name FROM team_members WHERE tenant_id=${tenant.id}
      AND id=ANY(${openingSlots.map((slot) => slot.teamMemberId)}::uuid[])
  ` : [];
  const staffNames = new Map(openingNames.map(({ id, name }) => [id, name]));
  const openingDate = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, weekday: "short", day: "numeric", month: "short" });
  const openingTime = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const addedDate = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium" });
  const preferredDate = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", dateStyle: "medium" });

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="waitlist" />
    <section className="reports-intro waitlist-intro">
      <div><h1>Waitlist</h1><span>{entries.length} {entryCountLabel}</span></div>
      <Link className="waybook-primary-link" href={addHref} scroll={false}><ListPlus aria-hidden="true" />Add {terminology.client}</Link>
    </section>

    <section className="waybook-data-card waitlist-register" aria-label="Waitlist entries">
      <div className="waybook-section-heading workspace-filter-bar">
        <h2>Waitlist entries</h2>
        <ListFilterOptions label="Waitlist" active={chosenStatus !== "waiting" || hasTableDateFilters(dates)} clearHref={path}>
          <label>Status
            <select name="status" defaultValue={chosenStatus}>
              {statuses.map(value => <option key={value} value={value}>{value === "all" ? "All" : statusLabel(value)}</option>)}
            </select>
          </label>
          <TableDateFields dates={dates} label="Preferred date range" />
        </ListFilterOptions>
      </div>

      {entries.length ? <div className="waybook-table-wrap waitlist-table-wrap">
        <table className="waitlist-table" role="table" aria-label="Waitlist results">
          <thead role="rowgroup"><tr role="row">
            {[clientLabel, "Request", "Preference", "Added", "Status", "Actions"].map(heading =>
              <th key={heading} scope="col" role="columnheader">{heading}</th>)}
          </tr></thead>
          <tbody role="rowgroup">{entries.map(entry => {
            const calendarHref = calendarHrefFor(entry);
            const timeWindow = entry.preferredStartTime && entry.preferredEndTime
              ? `${entry.preferredStartTime.slice(0, 5)}–${entry.preferredEndTime.slice(0, 5)}` : null;
            return <tr key={entry.id} role="row">
              <td className="waitlist-row__client" role="cell"><strong>{entry.customerName}</strong><small>{entry.customerEmail}</small></td>
              <td className="waitlist-row__request" role="cell">
                <span className="waitlist-row__label" aria-hidden="true">Request</span>
                <strong>{entry.serviceTitle}</strong><small>{entry.locationName}{entry.staffName ? ` · ${entry.staffName}` : ""}</small>
              </td>
              <td className="waitlist-row__preference" role="cell">
                <span className="waitlist-row__label" aria-hidden="true">Preference</span>
                {entry.preferredLocalDate ? <time dateTime={entry.preferredLocalDate}>{preferredDate.format(new Date(entry.preferredLocalDate))}</time>
                  : timeWindow ? "Any date" : "Flexible"}
                {timeWindow ? <small>{timeWindow}</small> : null}
              </td>
              <td className="waitlist-row__added" role="cell"><span className="waitlist-row__label" aria-hidden="true">Added</span>
                <time dateTime={entry.createdAt.toISOString()}>{addedDate.format(entry.createdAt)}</time>
              </td>
              <td className="waitlist-row__status" role="cell">
                <span className={`waybook-status-badge ${statusTone[entry.status] ?? ""}`}>{statusLabel(entry.status)}</span>
              </td>
              <td className="waitlist-row__actions" role="cell">
                {calendarHref ? (
                  requestedEntry?.id === entry.id
                    ? <div className="waitlist-openings">
                        {openingSlots.length ? <ul className="waitlist-openings__list">{openingSlots.map((slot) => (
                          <li key={slot.href}>
                            <span><strong>{openingDate.format(new Date(slot.startTime))} · {openingTime.format(new Date(slot.startTime))}–{openingTime.format(new Date(slot.endTime))}</strong>
                              <small>{staffNames.get(slot.teamMemberId)}</small></span>
                            <Link className="waybook-primary-link" href={slot.href} aria-label={`Book opening on ${openingDate.format(new Date(slot.startTime))} at ${openingTime.format(new Date(slot.startTime))}`}>Book</Link>
                          </li>
                        ))}</ul> : <p role="status">{entry.preferredLocalDate ? "No openings match this request." : "No matching openings in the next seven days."}</p>}
                        <Link className="waitlist-find-slot" href={filterHref} scroll={false}>Hide openings</Link>
                      </div>
                    : <Link className="waitlist-find-slot" href={`${filterHref}${filterHref.includes("?") ? "&" : "?"}openings=${entry.id}`} scroll={false}>Check openings</Link>
                ) : null}
                {calendarHref ? <Link className="waitlist-find-slot" href={calendarHref}><CalendarPlus aria-hidden="true" />Find a slot</Link> : null}
                <WaitlistStatusForm key={entry.status} entryId={entry.id} status={entry.status} />
              </td>
            </tr>;
          })}</tbody>
        </table>
      </div> : <div className="waitlist-empty">
        <CalendarDays aria-hidden="true" />
        <p>{dates.from || dates.to ? "No waitlist entries match this date range." : `No ${chosenStatus === "all" ? "" : statusLabel(chosenStatus).toLowerCase() + " "}waitlist entries.`}</p>
      </div>}
    </section>

    {formOpen ? <TenantEditorDialog title={`Add ${terminology.client} to waitlist`} closeHref={filterHref}>
      <aside className="tenant-drawer appointment-drawer" aria-label={`Add ${terminology.client} to waitlist`}>
        <header>
          <div><p>WAITLIST</p><h2>Add {terminology.client}</h2></div>
          <TenantEditorClose label="Close waitlist entry" href={filterHref}>×</TenantEditorClose>
        </header>
        <div className="appointment-drawer__body">
          <WaitlistForm terminology={terminology}
            canCreateClient={permissions.isManager || permissions.canManageClients}
            canSearchPhone={permissions.isManager || permissions.canViewClients || permissions.canManageClients} />
        </div>
      </aside>
    </TenantEditorDialog> : null}
  </main>;
}
