import Link from "next/link";
import { redirect } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";

type ClientResult = { id: string; name: string; email: string; phone: string | null; bookingCount: number; nextBookingAt: Date | null };
type AppointmentResult = { id: string; startsAt: Date; status: string; customerName: string; customerEmail: string; serviceTitle: string; teamMemberId: string | null; teamMemberName: string | null; locationId: string | null; locationName: string | null };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const permissions = await staffPermissionContext(tenant, membership);
  const canSearchAppointments = permissions.isManager || permissions.canManageOwnAppointments;
  const canSearchClients = permissions.isManager || permissions.canViewClients || permissions.canManageClients;
  if (!canSearchAppointments && !canSearchClients) redirect(tenantPath(tenantSlug, "/app"));

  const search = (q ?? "").trim().slice(0, 100);
  const pattern = `%${search}%`;
  const db = tenantDb(tenant);
  const [clients, appointments] = search ? await Promise.all([
    canSearchClients ? db<ClientResult[]>`
      SELECT c.id, c.name, c.email, c.phone, count(b.id)::int AS "bookingCount",
        min(b.starts_at) FILTER (WHERE b.status IN ('confirmed', 'arrived') AND b.starts_at >= now()) AS "nextBookingAt"
      FROM customers c
      LEFT JOIN bookings b ON b.customer_id = c.id AND b.tenant_id = c.tenant_id
      WHERE c.tenant_id = ${tenant.id}
        AND (c.name ILIKE ${pattern} OR c.email ILIKE ${pattern} OR coalesce(c.phone, '') ILIKE ${pattern})
      GROUP BY c.id
      ORDER BY "nextBookingAt" NULLS LAST, c.name
      LIMIT 12
    ` : Promise.resolve([] as ClientResult[]),
    canSearchAppointments ? db<AppointmentResult[]>`
      SELECT b.id, b.starts_at AS "startsAt", b.status, c.name AS "customerName", c.email AS "customerEmail",
        s.title AS "serviceTitle", b.team_member_id AS "teamMemberId", tm.name AS "teamMemberName",
        b.location_id AS "locationId", l.name AS "locationName"
      FROM bookings b
      JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN team_members tm ON tm.id = b.team_member_id AND tm.tenant_id = b.tenant_id
      LEFT JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
      WHERE b.tenant_id = ${tenant.id}
        ${permissions.isManager ? db`` : db`AND b.team_member_id = ${permissions.teamMemberId}`}
        AND (c.name ILIKE ${pattern} OR c.email ILIKE ${pattern} OR s.title ILIKE ${pattern} OR coalesce(tm.name, '') ILIKE ${pattern})
      ORDER BY b.starts_at DESC
      LIMIT 24
    ` : Promise.resolve([] as AppointmentResult[]),
  ]) : [[], []] as [ClientResult[], AppointmentResult[]];

  const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const clientHref = (id: string) => `${tenantPath(tenantSlug, "/app/customers")}?customer=${id}&q=${encodeURIComponent(search)}`;
  const appointmentHref = (item: AppointmentResult) => {
    if (!item.teamMemberId) return null;
    const params = new URLSearchParams({ employee: item.teamMemberId, booking: item.id, week: weekStartForLocalDate(tenantDateKey(item.startsAt, tenant.timezone)) });
    if (item.locationId) params.set("location", item.locationId);
    return `${tenantPath(tenantSlug, "/app/calendars")}?${params}`;
  };
  const total = clients.length + appointments.length;

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="search" />
    <section className="reports-intro"><div><p>SEARCH · DATABASE-BACKED</p><h1>Find a client or appointment</h1><span>Search only the records your role can access in {tenant.name}.</span></div></section>
    <section className="waybook-data-card">
      <div className="waybook-section-heading"><div><p>WORKSPACE SEARCH</p><h2>{search ? `${total} matching result${total === 1 ? "" : "s"}` : "Start a search"}</h2><span>{search ? `Results for “${search}”.` : "Look up a client by contact detail, or an appointment by client, service, or staff member."}</span></div><form method="get" className="waybook-list-filter"><label>Search<input name="q" type="search" defaultValue={search} placeholder="Client, service, or staff" autoFocus /></label><button type="submit">Search</button></form></div>
      {search && canSearchClients ? <section className="search-results"><div className="client-record__section-heading"><div><h3>Clients</h3><p>{clients.length ? "Open the client record or continue to their next booking." : "No matching clients."}</p></div></div><div className="waybook-table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th>Visits</th><th>Next appointment</th></tr></thead><tbody>{clients.map((client) => <tr key={client.id}><td><Link className="waybook-row-link" href={clientHref(client.id)}>{client.name}</Link></td><td>{client.email}<small>{client.phone ?? "No phone"}</small></td><td>{client.bookingCount}</td><td>{client.nextBookingAt ? dateTime.format(client.nextBookingAt) : "No upcoming appointment"}</td></tr>)}{clients.length === 0 ? <tr><td colSpan={4}>No clients match this search.</td></tr> : null}</tbody></table></div></section> : null}
      {search && canSearchAppointments ? <section className="search-results"><div className="client-record__section-heading"><div><h3>Appointments</h3><p>{appointments.length ? "Open an appointment in Calendar to manage its status, reschedule, or payment ledger." : "No matching appointments."}</p></div></div><div className="waybook-table-wrap"><table><thead><tr><th>When</th><th>Client</th><th>Service</th><th>Staff / location</th><th>Status</th></tr></thead><tbody>{appointments.map((appointment) => { const href = appointmentHref(appointment); return <tr key={appointment.id}><td>{href ? <Link className="waybook-row-link" href={href}>{dateTime.format(appointment.startsAt)}</Link> : dateTime.format(appointment.startsAt)}</td><td>{appointment.customerName}<small>{appointment.customerEmail}</small></td><td>{appointment.serviceTitle}</td><td>{appointment.teamMemberName ?? "Unassigned"}<small>{appointment.locationName ?? "No location"}</small></td><td>{appointment.status.replace("_", " ")}</td></tr>; })}{appointments.length === 0 ? <tr><td colSpan={5}>No appointments match this search.</td></tr> : null}</tbody></table></div></section> : null}
    </section>
  </main>;
}
