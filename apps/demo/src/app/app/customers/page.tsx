import { redirect } from "next/navigation";
import Link from "next/link";
import { CustomerForm } from "@/components/customer-form";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { logout } from "../../actions";

type CustomerRow = { id: string; name: string; email: string; phone: string | null; internalNotes: string | null; tags: string[]; createdAt: Date; bookingCount: number; bookedValueCents: number };
type CustomerBooking = { id: string; startsAt: Date; status: string; serviceTitle: string; staffName: string | null; priceCents: number; recommendedRebookDays: number | null };
const money = (cents: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(cents / 100);

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ customer?: string; q?: string; create?: string }> }) {
  const { customer: customerId, q, create } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  if (!await isFeatureEnabled(tenant.id, "clients")) redirect("/" + tenantSlug + "/app");
  const permissions = await staffPermissionContext(tenant, membership);
  const canManage = permissions.isManager || permissions.canManageClients;
  if (!canManage && !permissions.canViewClients) redirect("/" + tenantSlug + "/app");
  const db = tenantDb(tenant);
  const search = (q ?? "").trim().slice(0, 100);
  const pattern = "%" + search + "%";
  const customers = await db.unsafe<CustomerRow[]>("SELECT c.id,c.name,c.email,c.phone,c.internal_notes AS \"internalNotes\",c.tags,c.created_at AS \"createdAt\",count(b.id)::int AS \"bookingCount\",coalesce(sum(b.booked_price_cents) FILTER (WHERE b.status <> 'cancelled'),0)::int AS \"bookedValueCents\" FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id AND b.tenant_id=c.tenant_id WHERE c.tenant_id=$1 AND ($2='' OR c.name ILIKE $3 OR c.email ILIKE $3 OR coalesce(c.phone,'') ILIKE $3) GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100", [tenant.id, search, pattern]);
  const selected = customers.find((customer) => customer.id === customerId) ?? null;
  const history = selected ? await db.unsafe<CustomerBooking[]>("SELECT b.id,b.starts_at AS \"startsAt\",b.status,b.booked_price_cents AS \"priceCents\",s.title AS \"serviceTitle\",s.recommended_rebook_days AS \"recommendedRebookDays\",tm.name AS \"staffName\" FROM bookings b JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id LEFT JOIN team_members tm ON tm.id=b.team_member_id AND tm.tenant_id=b.tenant_id WHERE b.tenant_id=$1 AND b.customer_id=$2 ORDER BY b.starts_at DESC LIMIT 30", [tenant.id, selected.id]) : [];
  const closeHref = "/" + tenantSlug + "/app/customers" + (search ? "?q=" + encodeURIComponent(search) : "");
  const createHref = closeHref + (closeHref.includes("?") ? "&" : "?") + "create=1";
  const formOpen = canManage && (create === "1" || Boolean(selected));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const dateParts = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (name: string) => dateParts.find((item) => item.type === name)?.value ?? "";
  const appointmentHref = selected ? tenantPath(tenantSlug, "/app/calendars") + "?customer=" + selected.id + "&create=" + part("year") + "-" + part("month") + "-" + part("day") + "T09%3A00" : null;
  const latestCadencedBooking = history.find((booking) => booking.status !== "cancelled" && booking.recommendedRebookDays);
  const latestDateParts = latestCadencedBooking ? new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(latestCadencedBooking.startsAt) : [];
  const latestPart = (name: string) => latestDateParts.find((item) => item.type === name)?.value ?? "";
  const dueDate = latestCadencedBooking ? new Date(Date.UTC(Number(latestPart("year")), Number(latestPart("month")) - 1, Number(latestPart("day")) + latestCadencedBooking.recommendedRebookDays!)) : null;
  const dueStatus = dueDate ? dueDate.getTime() < Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))) ? "Overdue" : "Due " + dueDate.toLocaleDateString("en-GB", { timeZone: "UTC" }) : null;

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="clients" />
    <header><div><p>CLIENTS · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>{membership.role} · {tenant.timezone}</span></div><form action={logout}><button>Sign out</button></form></header>
    {canManage ? null : <p className="waybook-permission-note">Read-only access: client records cannot be changed with your role.</p>}
    <section className="waybook-data-card"><div className="waybook-section-heading"><div><h2>Clients</h2><p>{customers.length} persisted customer{customers.length === 1 ? "" : "s"}{search ? " matching “" + search + "”" : ""}. Confirmed public bookings appear here automatically.</p></div><div className="client-list-actions">{canManage ? <Link className="waybook-primary-link" href={createHref}>Add client</Link> : null}<form method="get" className="waybook-list-filter"><label>Search clients<input name="q" type="search" defaultValue={search} placeholder="Name, email, or phone" /></label><button type="submit">Search</button></form></div></div><div className="waybook-table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th>Bookings</th><th>Booked value</th><th>Added</th></tr></thead><tbody>{customers.map((customer) => { const customerHref = closeHref + (closeHref.includes("?") ? "&" : "?") + "customer=" + customer.id; return <tr key={customer.id} className="customer-table-row"><td><Link href={customerHref}>{customer.name}</Link></td><td><Link href={customerHref}>{customer.email}{customer.phone ? <small>{customer.phone}</small> : null}</Link></td><td><Link href={customerHref}>{customer.bookingCount}</Link></td><td><Link href={customerHref}>{money(customer.bookedValueCents)}</Link></td><td><Link href={customerHref}>{customer.createdAt.toLocaleDateString("en-GB", { timeZone: tenant.timezone })}</Link></td></tr>; })}{customers.length === 0 ? <tr><td colSpan={5}>No clients match this search.</td></tr> : null}</tbody></table></div></section>
    {formOpen ? <div className="client-form-modal-layer" role="presentation"><Link className="client-form-modal__scrim" aria-label="Close client form" href={closeHref} /><section className="client-form-modal" role="dialog" aria-modal="true" aria-label={selected ? "Edit client " + selected.name : "Add client"}><header><div><p>CLIENT RECORD</p><h2>{selected ? "Edit " + selected.name : "Add client"}</h2><span>{selected ? "Update contact details, tags, and internal notes." : "Create a tenant-scoped client record."}</span></div><Link className="client-form-modal__close" aria-label="Close client form" href={closeHref}>×</Link></header><div className="client-form-modal__body"><CustomerForm key={selected?.id ?? "new"} customer={selected} />{selected ? <><div className="appointment-drawer__summary"><strong>{selected.bookingCount} booking{selected.bookingCount === 1 ? "" : "s"} · {money(selected.bookedValueCents)}</strong><span>Booked service value excludes cancelled appointments; it is not paid revenue.</span></div>{dueStatus && latestCadencedBooking ? <section className="customer-notes"><h3>Return recommendation</h3><p><strong>{dueStatus}</strong> after {latestCadencedBooking.serviceTitle} ({latestCadencedBooking.recommendedRebookDays} days).</p></section> : null}{canManage && appointmentHref ? <Link className="waybook-primary-link" href={appointmentHref}>Book appointment</Link> : null}<section className="customer-history"><div><h3>Booking history</h3><p>Persisted appointments for this client.</p></div>{history.length ? <ul>{history.map((booking) => <li key={booking.id}><div><strong>{booking.serviceTitle}</strong><span>{time.format(booking.startsAt)} · {booking.staffName ?? "Unassigned"}</span></div><div><b>{money(booking.priceCents)}</b><small>{booking.status.replace("_", " ")}</small></div></li>)}</ul> : <p>No bookings yet.</p>}</section></> : null}</div></section></div> : selected ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" aria-label="Close client details" href={closeHref} /><aside className="tenant-drawer appointment-drawer" aria-label={"Client details for " + selected.name}><header><div><p>CLIENT HISTORY</p><h2>{selected.name}</h2><span>{selected.email}{selected.phone ? " · " + selected.phone : ""}</span></div><Link className="tenant-drawer-close" aria-label="Close client details" href={closeHref}>×</Link></header><div className="appointment-drawer__body"><section className="customer-history"><div><h3>Booking history</h3><p>Persisted appointments for this client.</p></div>{history.length ? <ul>{history.map((booking) => <li key={booking.id}><div><strong>{booking.serviceTitle}</strong><span>{time.format(booking.startsAt)} · {booking.staffName ?? "Unassigned"}</span></div><div><b>{money(booking.priceCents)}</b><small>{booking.status.replace("_", " ")}</small></div></li>)}</ul> : <p>No bookings yet.</p>}</section></div></aside></div> : null}
  </main>;
}
