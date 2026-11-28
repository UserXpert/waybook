import { ListFilterOptions } from "@/components/workspace-options";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";
import { redirect } from "next/navigation";
import Link from "next/link";
import { CustomerForm } from "@/components/customer-form";
import { TableDateFields } from "@/components/table-date-fields";
import { clientDirectoryAppointment, clientDirectoryQuery } from "@/lib/waybook/client-lookup-query";
import { hasTableDateFilters, dateFilterParams, tableDateFilters, type TableDateParams } from "@/lib/waybook/table-date-filters";
import { ClientDirectoryList } from "@/components/client-directory-list";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { logout } from "../../actions";

type CustomerRow = { id: string; name: string; email: string; phone: string | null; createdAt: Date; bookingCount: number; bookedValueCents: number; lastBookingAt: Date | null; nextBookingAt: Date | null };
type CustomerBooking = { id: string; serviceId: string; startsAt: Date; endsAt: Date; status: string; serviceTitle: string; staffName: string | null; priceCents: number; recommendedRebookDays: number | null };
type PaymentItem = { id: string; kind: string; amountCents: number; method: string; recordedAt: Date; serviceTitle: string };
type GiftCardItem = { id: string; codeLastFour: string; status: string; currency: string; balanceCents: number };
const money = (cents: number, currency = "DKK") => new Intl.NumberFormat("en-DK", {
  style: "currency", currency, minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
}).format(cents / 100);

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ customer?: string; q?: string; after?: string; create?: string; edit?: string } & TableDateParams> }) {
  const { customer: customerId, q, after, create, edit, sort, from, to } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  if (!await isFeatureEnabled(tenant.id, "clients")) redirect("/" + tenantSlug + "/app");
  const permissions = await staffPermissionContext(tenant, membership);
  const canManage = permissions.isManager || permissions.canManageClients;
  if (!canManage && !permissions.canViewClients) redirect("/" + tenantSlug + "/app");
  const { client, clients } = await getTenantTerminology(tenant);
  const clientTitle = titleTerminology(client);
  const clientsTitle = titleTerminology(clients);
  const db = tenantDb(tenant);
  const search = (q ?? "").trim().slice(0, 100);
  const pattern = `%${search}%`;
  const rawCursor = (after ?? "").trim();
  const cursor = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rawCursor) ? rawCursor : null;
  const customerRowSql = "SELECT c.id,c.name,c.email,c.phone,c.created_at AS \"createdAt\",count(b.id)::int AS \"bookingCount\",coalesce(sum(b.booked_price_cents) FILTER (WHERE b.status <> 'cancelled'),0)::int AS \"bookedValueCents\",max(b.starts_at) FILTER (WHERE b.status NOT IN ('cancelled','no_show') AND b.starts_at < now()) AS \"lastBookingAt\",min(b.starts_at) FILTER (WHERE b.status IN ('confirmed','arrived') AND b.starts_at >= now()) AS \"nextBookingAt\" FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id AND b.tenant_id=c.tenant_id";
  const directoryFilter = "c.tenant_id=$1 AND ($2='' OR c.name ILIKE $3 OR c.email ILIKE $3 OR coalesce(c.phone,'') ILIKE $3)";
  const directoryParameters = [tenant.id, search, pattern];
  const dates = tableDateFilters({ sort, from, to }, tenant.timezone);
  const hasRange = Boolean(dates.start || dates.end);
  const [directoryRows, [summary]] = await Promise.all([
    db.unsafe<CustomerRow[]>(clientDirectoryQuery, [...directoryParameters, cursor, 51, dates.sort, dates.start, dates.end]),
    db.unsafe<{ matching: number; returning: number; bookedAhead: number }[]>(`
      SELECT count(*)::int AS matching,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM bookings b WHERE b.tenant_id=c.tenant_id AND b.customer_id=c.id OFFSET 1
        ))::int AS returning,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM bookings b WHERE b.tenant_id=c.tenant_id AND b.customer_id=c.id
            AND b.status IN ('confirmed','arrived') AND b.starts_at >= now()
        ))::int AS "bookedAhead"
      FROM customers c ${hasRange ? clientDirectoryAppointment : ""} WHERE ${directoryFilter}
      ${hasRange ? "AND ($4::timestamptz IS NULL OR next.date >= $4) AND ($5::timestamptz IS NULL OR next.date < $5)" : ""}
    `, hasRange ? [...directoryParameters, dates.start, dates.end] : directoryParameters),
  ]);
  const hasMore = directoryRows.length > 50;
  const customers = directoryRows.slice(0, 50);
  const selectedFromDirectory = customers.find((customer) => customer.id === customerId) ?? null;
  const selected = selectedFromDirectory ?? (customerId ? (await db.unsafe<CustomerRow[]>(customerRowSql + " WHERE c.tenant_id=$1 AND c.id=$2::uuid GROUP BY c.id", [tenant.id, customerId]))[0] ?? null : null);
  const [history, payments, giftCards, paymentTotals] = selected ? await Promise.all([
    db.unsafe<CustomerBooking[]>("SELECT b.id,b.service_id AS \"serviceId\",b.starts_at AS \"startsAt\",b.ends_at AS \"endsAt\",b.status,b.booked_price_cents AS \"priceCents\",s.title AS \"serviceTitle\",s.recommended_rebook_days AS \"recommendedRebookDays\",tm.name AS \"staffName\" FROM bookings b JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id LEFT JOIN team_members tm ON tm.id=b.team_member_id AND tm.tenant_id=b.tenant_id WHERE b.tenant_id=$1 AND b.customer_id=$2 ORDER BY b.starts_at DESC LIMIT 40", [tenant.id, selected.id]),
    db.unsafe<PaymentItem[]>("SELECT pr.id,pr.kind,pr.amount_cents AS \"amountCents\",pr.method,pr.recorded_at AS \"recordedAt\",s.title AS \"serviceTitle\" FROM payment_records pr JOIN bookings b ON b.id=pr.booking_id AND b.tenant_id=pr.tenant_id JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id WHERE pr.tenant_id=$1 AND b.customer_id=$2 ORDER BY pr.recorded_at DESC LIMIT 12", [tenant.id, selected.id]),
    db.unsafe<GiftCardItem[]>("SELECT gc.id,gc.code_last_four AS \"codeLastFour\",gc.status,gc.currency,coalesce(sum(CASE WHEN gce.direction='credit' THEN gce.amount_cents WHEN gce.direction='debit' THEN -gce.amount_cents ELSE 0 END),0)::int AS \"balanceCents\" FROM commerce_gift_cards gc LEFT JOIN commerce_gift_card_entries gce ON gce.gift_card_id=gc.id AND gce.tenant_id=gc.tenant_id WHERE gc.tenant_id=$1 AND gc.issued_to_customer_id=$2 GROUP BY gc.id ORDER BY gc.created_at DESC", [tenant.id, selected.id]),
    db<{ paidCents: string }[]>`
      SELECT coalesce(sum(CASE WHEN pr.kind = 'refund' THEN -pr.amount_cents ELSE pr.amount_cents END), 0) AS "paidCents"
      FROM payment_records pr
      JOIN bookings b ON b.id=pr.booking_id AND b.tenant_id=pr.tenant_id
      WHERE pr.tenant_id=${tenant.id} AND b.customer_id=${selected.id}
    `,
  ]) : [[], [], [], []] as [CustomerBooking[], PaymentItem[], GiftCardItem[], { paidCents: string }[]];
  const searchInputId = "client-directory-search";
  const listParams = dateFilterParams(new URLSearchParams(search ? { q: search } : {}), dates);
  const closeHref = "/" + tenantSlug + "/app/customers" + (listParams.size ? `?${listParams}` : "");
  const selectedHref = (customer: CustomerRow, suffix = "") => closeHref + (closeHref.includes("?") ? "&" : "?") + "customer=" + customer.id + suffix;
  const createHref = closeHref + (closeHref.includes("?") ? "&" : "?") + "create=1";
  const editHref = selected ? selectedHref(selected, "&edit=1") : closeHref;
  const formOpen = canManage && (create === "1" || (Boolean(selected) && edit === "1"));
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const shortDate = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium" });
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: tenant.timezone }).format(new Date());
  const appointmentHref = selected ? tenantPath(tenantSlug, "/app/calendars") + `?customer=${selected.id}&create=${todayKey}T09%3A00` : null;
  const rebookHref = (booking: CustomerBooking) => selected ? tenantPath(tenantSlug, "/app/calendars") + `?customer=${selected.id}&service=${booking.serviceId}&create=${todayKey}T09%3A00` : null;
  const upcoming = history.filter((booking) => booking.startsAt >= new Date() && ["confirmed", "arrived"].includes(booking.status)).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const latestCadencedBooking = history.find((booking) => booking.status !== "cancelled" && booking.recommendedRebookDays);
  const dueDate = latestCadencedBooking ? new Date(latestCadencedBooking.startsAt.getTime() + latestCadencedBooking.recommendedRebookDays! * 86_400_000) : null;
  const dueStatus = dueDate ? dueDate < new Date() ? "Overdue for return" : `Due ${shortDate.format(dueDate)}` : null;
  const paidCents = Number(paymentTotals[0]?.paidCents ?? 0);

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="clients" />
    <header><div><p>{clients.toUpperCase()} · DATABASE-BACKED</p><h1>{tenant.name}</h1><span>{membership.role} · {tenant.timezone}</span></div><form action={logout}><button>Sign out</button></form></header>
    {canManage ? null : <p className="waybook-permission-note">Your role has read-only access to {client} records.</p>}
    <section className="waybook-data-metrics client-pulse"><article><span>{clientsTitle}</span><strong>{summary.matching}</strong><small>Matching the current directory</small></article><article><span>Returning</span><strong>{summary.returning}</strong><small>Two or more bookings</small></article><article><span>Booked ahead</span><strong>{summary.bookedAhead}</strong><small>{clientsTitle} with a future appointment</small></article></section>
    <section className="waybook-data-card"><div className="waybook-section-heading"><div><p>{client.toUpperCase()} DIRECTORY</p><h2>{clientsTitle}</h2><span>Search people, open their record, and act on the next appointment.</span></div><div className="client-list-actions">{canManage ? <Link className="waybook-primary-link" href={createHref}>Add {client}</Link> : null}</div></div><div className="workspace-filter-bar workspace-filter-bar--search">
      <form method="get" className="waybook-list-filter workspace-quick-search"><label>Search {clients}<input id={searchInputId} name="q" type="search" defaultValue={search} placeholder="Name, email, or phone" /></label>{dates.sort !== "today" ? <input type="hidden" name="sort" value={dates.sort} /> : null}
        {dates.from ? <input type="hidden" name="from" value={dates.from} /> : null}
        {dates.to ? <input type="hidden" name="to" value={dates.to} /> : null}
        <button type="submit">Search</button>
      </form>
      <ListFilterOptions label={clientsTitle} active={hasTableDateFilters(dates)} clearHref={tenantPath(tenantSlug, "/app/customers") + (search ? `?q=${encodeURIComponent(search)}` : "")}>
        {search ? <input type="hidden" name="q" value={search} /> : null}
        <TableDateFields dates={dates} label="Next appointment range" />
      </ListFilterOptions>
    </div><ClientDirectoryList key={JSON.stringify([tenant.id, listParams.toString(), cursor])} recordOpen={Boolean(selected)} searchInputId={searchInputId} initialClients={customers.map((customer) => ({ id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, bookingCount: customer.bookingCount, bookedValueCents: customer.bookedValueCents, lastBookingAt: customer.lastBookingAt?.toISOString() ?? null, nextBookingAt: customer.nextBookingAt?.toISOString() ?? null }))} initialNextCursor={hasMore ? customers.at(-1)?.id ?? null : null} filters={listParams.toString()} path={"/" + tenantSlug + "/app/customers"} timeZone={tenant.timezone} clientLabel={client} clientsLabel={clients} /></section>
    {selected ? <TenantEditorDialog key={selected.id} title={`${clientTitle} record for ${selected.name}`} closeHref={closeHref} showScrim={!formOpen} cycleFocus><aside className="tenant-drawer appointment-drawer client-record" aria-label={`${clientTitle} record for ${selected.name}`}><header><div><p>{client.toUpperCase()} RECORD</p><h2>{selected.name}</h2><span>{selected.email}{selected.phone ? ` · ${selected.phone}` : ""}</span></div><div className="client-record__header-actions">{canManage ? <Link href={editHref}>Edit</Link> : null}<TenantEditorClose label={`Close ${client} record`} href={closeHref}>×</TenantEditorClose></div></header><div className="appointment-drawer__body"><nav className="client-record__tabs" aria-label={`${clientTitle} record sections`}><a href="#client-overview">Overview</a><a href="#client-timeline">Timeline</a><a href="#client-wallet">Wallet</a></nav><section id="client-overview" className="client-record__overview"><div><span>Visits</span><strong>{selected.bookingCount}</strong></div><div><span>Booked value</span><strong>{money(selected.bookedValueCents)}</strong></div><div><span>Paid to date</span><strong>{money(paidCents)}</strong></div></section>{dueStatus && latestCadencedBooking ? <section className="customer-notes"><h3>{dueStatus}</h3><p>Based on {latestCadencedBooking.serviceTitle}’s {latestCadencedBooking.recommendedRebookDays}-day return cadence.</p></section> : null}{canManage && appointmentHref ? <Link className="waybook-primary-link" href={appointmentHref}>Book appointment</Link> : null}<section><div className="client-record__section-heading"><div><h3>Upcoming appointments</h3><p>Confirmed appointments for this {client}.</p></div></div>{upcoming.length ? <ul className="client-record__upcoming">{upcoming.map((booking) => <li key={booking.id}><div><strong>{booking.serviceTitle}</strong><span>{time.format(booking.startsAt)} · {booking.staffName ?? "Unassigned"}</span></div><b>{booking.status === "arrived" ? "Checked in" : "Confirmed"}</b></li>)}</ul> : <p className="client-record__empty">No upcoming appointments.</p>}</section><section id="client-wallet"><div className="client-record__section-heading"><div><h3>Wallet & payments</h3><p>Recorded payments and balances.</p></div></div>{payments.length ? <ul className="client-record__ledger">{payments.map((item) => <li key={item.id}><div><strong>{item.serviceTitle}</strong><span>{time.format(item.recordedAt)} · {item.method.replace("_", " ")}</span></div><b className={item.kind === "refund" ? "is-refund" : ""}>{item.kind === "refund" ? "−" : "+"}{money(item.amountCents)}</b></li>)}</ul> : <p className="client-record__empty">No payment records yet.</p>}{giftCards.length ? <><h4>Gift cards</h4><ul className="client-record__ledger">{giftCards.map((giftCard) => <li key={giftCard.id}><div><strong>Gift card ending {giftCard.codeLastFour}</strong><span>{giftCard.status}</span></div><b>{money(giftCard.balanceCents, giftCard.currency)}</b></li>)}</ul></> : <p className="client-record__empty">No gift cards linked to this {client}.</p>}</section><section id="client-timeline" className="customer-history"><div><h3>Service timeline</h3><p>Appointments, services and outcomes.</p></div>{history.length ? <ul>{history.map((booking) => <li key={booking.id}><div><strong>{booking.serviceTitle}</strong><span>{time.format(booking.startsAt)} · {booking.staffName ?? "Unassigned"}</span></div><div><b>{money(booking.priceCents)}</b><small>{booking.status.replace("_", " ")}</small>{canManage && booking.status !== "cancelled" && rebookHref(booking) ? <Link className="client-record__rebook" href={rebookHref(booking)!}>Book again</Link> : null}</div></li>)}</ul> : <p>No appointments yet.</p>}</section></div></aside></TenantEditorDialog> : null}
    {formOpen ? <TenantEditorDialog key={selected ? `edit-${selected.id}` : "new"} title={selected ? `Edit ${client} ${selected.name}` : `Add ${client}`} closeHref={selected ? selectedHref(selected) : closeHref} initialField="name" centered><section className="client-form-modal"><header><div><p>{client.toUpperCase()} RECORD</p><h2>{selected ? "Edit " + selected.name : `Add ${client}`}</h2><span>Update contact details.</span></div><TenantEditorClose className="client-form-modal__close" label={`Close ${client} form`} href={selected ? selectedHref(selected) : closeHref}>×</TenantEditorClose></header><div className="client-form-modal__body"><CustomerForm key={selected?.id ?? "new"} customer={selected} clientLabel={client} /></div></section></TenantEditorDialog> : null}
  </main>;
}
