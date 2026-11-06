import Link from "next/link";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { logout } from "../../actions";

type BookingRow = { id: string; startsAt: Date; endsAt: Date; status: string; source: string; bookedPriceCents: number; paidCents: number; customerName: string; customerEmail: string; serviceTitle: string; teamMemberId: string | null; teamMemberName: string | null; locationId: string | null; locationName: string | null; resourceName: string | null };
type Location = { id: string; name: string };
const bookingStatuses = ["confirmed", "arrived", "completed", "cancelled", "no_show"] as const;
const money = (cents: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(cents / 100);

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ location?: string; status?: string }> }) {
  const { location, status } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageOwnAppointments) throw new Error("You do not have permission to view bookings.");
  const db = tenantDb(tenant);
  const locations = await db<Location[]>`SELECT id, name FROM locations WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY CASE WHEN slug = 'primary' THEN 0 ELSE 1 END, name`;
  const selectedLocation = locations.find((item) => item.id === location);
  const selectedStatus = bookingStatuses.includes(status as typeof bookingStatuses[number]) ? status : undefined;
  const bookings = await db<BookingRow[]>`
    SELECT b.id, b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.source, b.booked_price_cents AS "bookedPriceCents", coalesce(sum(CASE WHEN pr.kind='payment' THEN pr.amount_cents ELSE -pr.amount_cents END), 0)::int AS "paidCents",
      c.name AS "customerName", c.email AS "customerEmail", s.title AS "serviceTitle", tm.id AS "teamMemberId", tm.name AS "teamMemberName", b.location_id AS "locationId", l.name AS "locationName", r.name AS "resourceName"
    FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN team_members tm ON tm.id = b.team_member_id AND tm.tenant_id = b.tenant_id
      LEFT JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
      LEFT JOIN resources r ON r.id = b.resource_id AND r.tenant_id = b.tenant_id
      LEFT JOIN payment_records pr ON pr.booking_id = b.id AND pr.tenant_id = b.tenant_id
    WHERE b.tenant_id = ${tenant.id} ${permissions.isManager ? db`` : db`AND b.team_member_id = ${permissions.teamMemberId}`} ${selectedLocation ? db`AND b.location_id = ${selectedLocation.id}` : db``} ${selectedStatus ? db`AND b.status = ${selectedStatus}` : db``}
    GROUP BY b.id, c.id, s.id, tm.id, l.id, r.id ORDER BY b.starts_at DESC LIMIT 100
  `;
  const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const calendarHrefFor = (booking: BookingRow) => {
    if (!booking.teamMemberId) return null;
    const params = new URLSearchParams({
      employee: booking.teamMemberId,
      booking: booking.id,
      week: weekStartForLocalDate(tenantDateKey(booking.startsAt, tenant.timezone)),
    });
    if (booking.locationId) params.set("location", booking.locationId);
    return `${tenantPath(tenantSlug, "/app/calendars")}?${params}`;
  };
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="bookings" /><header><div><p>BOOKINGS · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>{bookings.length} latest booking{bookings.length === 1 ? "" : "s"} · {tenant.timezone}</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Booking operations</h2><p>Every row is a persisted booking from this tenant database. Payment is an immutable ledger, not a replacement for booked service value.</p></div><form method="get" className="waybook-list-filter"><label>Location<select name="location" defaultValue={selectedLocation?.id ?? ""}><option value="">All locations</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Status<select name="status" defaultValue={selectedStatus ?? ""}><option value="">All statuses</option>{bookingStatuses.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select></label><button type="submit">Apply</button></form></div><div className="waybook-table-wrap"><table><thead><tr><th>When</th><th>Client</th><th>Service</th><th>Location</th><th>Employee / resource</th><th>Settlement</th><th>Source</th><th>Status</th></tr></thead><tbody>{bookings.map((booking) => { const calendarHref = calendarHrefFor(booking); const balance = booking.bookedPriceCents - booking.paidCents; return <tr key={booking.id}><td>{calendarHref ? <Link className="waybook-row-link" href={calendarHref}>{dateTime.format(booking.startsAt)}</Link> : dateTime.format(booking.startsAt)}<small>Ends {new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, timeStyle: "short" }).format(booking.endsAt)}</small></td><td>{booking.customerName}<small>{booking.customerEmail}</small></td><td>{booking.serviceTitle}</td><td>{booking.locationName ?? "Not recorded"}</td><td>{booking.teamMemberName ?? "Unassigned"}<small>{booking.resourceName ?? "No resource"}</small></td><td>{money(booking.paidCents)} paid<small>{balance > 0 ? `${money(balance)} due` : balance < 0 ? `${money(-balance)} overpaid` : "Settled"}</small></td><td>{booking.source}</td><td>{booking.status.replace("_", " ")}</td></tr>; })}{bookings.length === 0 ? <tr><td colSpan={8}>No bookings match these filters.</td></tr> : null}</tbody></table></div></section></main>;
}
