import Link from "next/link";
import { BookingListRow, CopyBookingValue } from "@/components/booking-list-controls";
import { AppointmentDrawerActions } from "@/components/appointment-drawer-actions";
import { CancelAppointmentForm } from "@/components/cancel-appointment-form";
import { cancelAppointment, getRescheduleBookingAvailability, rescheduleBooking, updateBookingDetails, updateBookingStatus } from "../calendars/actions";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { requireFeature } from "@/lib/waybook/features";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { tenantDateKey } from "@/lib/waybook/today-command-centre";
import { logout } from "../../actions";

type BookingRow = { id: string; bookingNumber: string; serviceId: string; resourceId: string | null; customerPhone: string | null; saleId: string | null; startsAt: Date; endsAt: Date; status: string; source: string; bookedPriceCents: number; paidCents: number; customerName: string; customerEmail: string; serviceTitle: string; teamMemberId: string | null; teamMemberName: string | null; locationId: string | null; locationName: string | null; resourceName: string | null };
type Location = { id: string; name: string };
const bookingStatuses = ["confirmed", "arrived", "completed", "cancelled", "no_show"] as const;
const money = (cents: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(cents / 100);

export default async function BookingsPage({ searchParams }: { searchParams: Promise<{ location?: string; status?: string; q?: string; booking?: string }> }) {
  const { location, status, q, booking: selectedId } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageOwnAppointments) throw new Error("You do not have permission to view bookings.");
  const db = tenantDb(tenant);
  const locations = await db<Location[]>`SELECT id, name FROM locations WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY CASE WHEN slug = 'primary' THEN 0 ELSE 1 END, name`;
  const selectedLocation = locations.find((item) => item.id === location);
  const selectedStatus = bookingStatuses.includes(status as typeof bookingStatuses[number]) ? status : undefined;
  const search = (q ?? "").trim().slice(0, 100);
  const pattern = `%${search}%`;
  const bookings = await db<BookingRow[]>`
    SELECT b.id, b.booking_number AS "bookingNumber", b.service_id AS "serviceId", bra.resource_id AS "resourceId", c.phone AS "customerPhone", cs.id AS "saleId", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.source, b.booked_price_cents AS "bookedPriceCents", coalesce(sum(CASE WHEN pr.kind='payment' THEN pr.amount_cents ELSE -pr.amount_cents END), 0)::int AS "paidCents",
      c.name AS "customerName", c.email AS "customerEmail", s.title AS "serviceTitle", tm.id AS "teamMemberId", tm.name AS "teamMemberName", b.location_id AS "locationId", l.name AS "locationName", r.name AS "resourceName"
    FROM bookings b JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN team_members tm ON tm.id = b.team_member_id AND tm.tenant_id = b.tenant_id
      LEFT JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
      LEFT JOIN booking_resource_assignments bra ON bra.booking_id=b.id AND bra.tenant_id=b.tenant_id AND bra.released_at IS NULL
      LEFT JOIN resources r ON r.id = bra.resource_id AND r.tenant_id = b.tenant_id
      LEFT JOIN commerce_sales cs ON cs.booking_id = b.id AND cs.tenant_id = b.tenant_id
      LEFT JOIN payment_records pr ON pr.booking_id = b.id AND pr.tenant_id = b.tenant_id
    WHERE b.tenant_id = ${tenant.id} ${permissions.isManager ? db`` : db`AND b.team_member_id = ${permissions.teamMemberId}`} ${selectedLocation ? db`AND b.location_id = ${selectedLocation.id}` : db``} ${selectedStatus ? db`AND b.status = ${selectedStatus}` : db``} ${search ? db`AND (c.name ILIKE ${pattern} OR c.email ILIKE ${pattern} OR b.booking_number ILIKE ${pattern} OR s.title ILIKE ${pattern} OR coalesce(tm.name, '') ILIKE ${pattern})` : db``}
    GROUP BY b.id, cs.id, c.id, s.id, tm.id, l.id, r.id, bra.resource_id ORDER BY b.starts_at DESC LIMIT 100
  `;
  const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const saleHrefFor = (booking: BookingRow) => booking.saleId && permissions.isManager ? `${tenantPath(tenantSlug, "/app/sales")}?sale=${booking.saleId}` : null;
  const selectedBooking = bookings.find(item => item.id === selectedId);
  const closeParams = new URLSearchParams();
  if (location) closeParams.set("location", location);
  if (status) closeParams.set("status", status);
  if (search) closeParams.set("q", search);
  const basePath = tenantPath(tenantSlug, "/app/bookings");
  const closeHref = `${basePath}${closeParams.size ? `?${closeParams}` : ""}`;
  const bookingHref = (id: string) => { const params = new URLSearchParams(closeParams); params.set("booking", id); return `${basePath}?${params}`; };
  const today = tenantDateKey(new Date(), tenant.timezone);
  const days = Array.from({ length: 7 }, (_, index) => { const date = new Date(`${today}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index); return date.toISOString().slice(0,10); });
  const canManage = ["owner", "manager"].includes(membership.role);
  const slots = selectedBooking?.teamMemberId && canManage ? (await getRescheduleBookingAvailability({ bookingId: selectedBooking.id, startDate: days[0] })).slots : [];
  const resources = selectedBooking && canManage ? await db<{ id: string; name: string; isMutuallyExclusive: boolean }[]>`SELECT r.id,r.name,r.is_mutually_exclusive AS "isMutuallyExclusive" FROM resources r JOIN resource_locations rl ON rl.tenant_id=r.tenant_id AND rl.resource_id=r.id AND rl.location_id=${selectedBooking.locationId} JOIN service_resources sr ON sr.tenant_id=r.tenant_id AND sr.resource_id=r.id AND sr.service_id=${selectedBooking.serviceId} WHERE r.tenant_id=${tenant.id} AND r.is_active=TRUE ORDER BY r.name` : [];
  return <main className="waybook-data-page tenant-dashboard-page"><TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="bookings" /><header><div><p>BOOKINGS · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>{bookings.length} latest booking{bookings.length === 1 ? "" : "s"} · {tenant.timezone}</span></div><form action={logout}><button>Sign out</button></form></header><section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Booking operations</h2><p>Every row is a persisted booking from this tenant database. Payment is an immutable ledger, not a replacement for booked service value.</p></div><form method="get" className="waybook-list-filter">{search ? <input type="hidden" name="q" value={search} /> : null}<label>Location<select name="location" defaultValue={selectedLocation?.id ?? ""}><option value="">All locations</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Status<select name="status" defaultValue={selectedStatus ?? ""}><option value="">All statuses</option>{bookingStatuses.map((item) => <option key={item} value={item}>{item.replace("_", " ")}</option>)}</select></label><button type="submit">Apply</button></form></div><div className="waybook-table-wrap"><table><thead><tr><th>When</th><th>Booking number</th><th>Client</th><th>Service</th><th>Location</th><th>Employee / resource</th><th>Settlement</th><th>Source</th><th>Status</th></tr></thead><tbody>{bookings.map((booking) => { const saleHref = saleHrefFor(booking); const balance = booking.bookedPriceCents - booking.paidCents; return <BookingListRow key={booking.id} href={bookingHref(booking.id)}><td>{dateTime.format(booking.startsAt)}<small>Ends {new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, timeStyle: "short" }).format(booking.endsAt)}</small></td><td><CopyBookingValue value={booking.bookingNumber} label="booking number" /></td><td>{booking.customerName}<small><CopyBookingValue value={booking.customerEmail} label="email" /></small></td><td>{booking.serviceTitle}</td><td>{booking.locationName ?? "Not recorded"}</td><td>{booking.teamMemberName ?? "Unassigned"}<small>{booking.resourceName ?? "No resource"}</small></td><td>{saleHref ? <Link className="waybook-row-link" href={saleHref}>{money(booking.paidCents)} paid</Link> : `${money(booking.paidCents)} paid`}<small>{balance > 0 ? `${money(balance)} due` : balance < 0 ? `${money(-balance)} overpaid` : "Settled"}{saleHref ? " · View sale" : ""}</small></td><td>{booking.source}</td><td>{booking.status.replace("_", " ")}</td></BookingListRow>; })}{bookings.length === 0 ? <tr><td colSpan={9}>No bookings match these filters.</td></tr> : null}</tbody></table></div></section>{selectedBooking ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" href={closeHref} aria-hidden="true" tabIndex={-1} /><aside className="tenant-drawer appointment-drawer manual-appointment-drawer" aria-label={`Appointment with ${selectedBooking.customerName}`}><header><div><p>APPOINTMENT</p><h2>{selectedBooking.customerName}</h2></div><div className="appointment-drawer__header-actions"><Link className="tenant-drawer-close" href={closeHref} aria-label="Close appointment">×</Link></div></header><div className="appointment-drawer__body"><section className="appointment-drawer__details"><dl><div><dt>Status</dt><dd>{selectedBooking.status.replace("_", " ")}</dd></div><div><dt>Date</dt><dd>{dateTime.format(selectedBooking.startsAt)}</dd></div><div><dt>Service</dt><dd>{selectedBooking.serviceTitle}</dd></div><div><dt>Staff</dt><dd>{selectedBooking.teamMemberName ?? "Unassigned"}</dd></div><div><dt>Booking number</dt><dd><CopyBookingValue value={selectedBooking.bookingNumber} label="booking number" /></dd></div></dl></section>{canManage ? <><AppointmentDrawerActions key={selectedBooking.id} bookingId={selectedBooking.id} customerName={selectedBooking.customerName} customerEmail={selectedBooking.customerEmail} customerPhone={selectedBooking.customerPhone} status={selectedBooking.status} timezone={tenant.timezone} days={days} slots={slots} saveDetails={updateBookingDetails} reschedule={rescheduleBooking} updateStatus={updateBookingStatus} resourceId={selectedBooking.resourceId} resources={resources} />{selectedBooking.status !== "cancelled" && selectedBooking.status !== "completed" ? <CancelAppointmentForm bookingId={selectedBooking.id} cancelAppointment={cancelAppointment} /> : null}</> : <p className="tenant-drawer-note">Read-only access: appointment changes require an owner or manager.</p>}</div></aside></div> : null}</main>;
}
