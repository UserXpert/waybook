import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppointmentPaymentBalance } from "@/lib/waybook/appointment-payment-balance";
import { RecordedAppointmentPayments } from "@/components/recorded-appointment-payments";
import { AppointmentPaymentForm } from "@/components/appointment-payment-form";
import { TableDateFields } from "@/components/table-date-fields";
import { dateFilterParams, dateRangeWhere, tableDateFilters, tableDateOrder, type TableDateParams } from "@/lib/waybook/table-date-filters";
import { BookingListRow } from "@/components/booking-list-controls";
import { SaleAppointmentDetailsForm } from "@/components/sale-appointment-details-form";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { GiftCardTenderForm } from "@/components/gift-card-tender-form";
import { controlDb, tenantDb } from "@/lib/waybook/database";
import { requirePageFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { addProductToAppointmentSale, redeemPackageForAppointmentSale } from "./actions";

type SaleRow = {
  id: string;
  bookingId: string;
  bookingNumber: string;
  customerId: string;
  currency: string;
  startsAt: Date;
  status: string;
  bookedPriceCents: number;
  noShowChargeCents: number;
  paidCents: number;
  paymentCount: number;
  lastPaymentAt: Date | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  serviceTitle: string;
  teamMemberId: string | null;
  teamMemberName: string | null;
  locationId: string | null;
  locationName: string | null;
  packageRedeemed: boolean;
  giftCardRedeemed: boolean;
};
type Location = { id: string; name: string };
type Product = { id: string; title: string; priceCents: number; currency: string };
type SaleLine = { id: string; title: string; unitPriceCents: number; quantity: number; discountCents: number };
type PaymentItem = { id: string; kind: "payment" | "refund"; amountCents: number; method: string; recordedAt: Date; adjustment: boolean };
type EligiblePackage = { id: string; title: string; remainingUnits: number; expiresAt: Date | null };
type BookingActivity = { id: string; eventType: string; actorIdentityId: string | null; createdAt: Date };
type ActivityActor = { id: string; displayName: string };
type SaleSummary = { outstandingCents: string; collectedCents: string; refundDueCents: string; matchingCount: number; page: number };

const salesPageSize = 150;
const saleStatuses = ["all", "open", "paid", "refund", "cancelled"];
const defaultSaleSort = "appointment-today";
const saleSortOptions = [
  { value: defaultSaleSort, label: "Appointment date · today first" },
  { value: "appointment-newest", label: "Appointment date · newest first" },
  { value: "appointment-oldest", label: "Appointment date · oldest first" },
  { value: "payment-newest", label: "Payment activity · newest first" },
  { value: "payment-oldest", label: "Payment activity · oldest first" },
] as const;
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const money = (cents: number) => new Intl.NumberFormat("en-DK", {
  style: "currency", currency: "DKK", minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
}).format(cents / 100);

function activityLabel(eventType: string, clientLabel: string) {
  const labels: Record<string, string> = {
    "booking.created_by_tenant": "Appointment created",
    "booking.confirmed": "Appointment confirmed",
    "booking.rescheduled": "Appointment rescheduled",
    "booking.cancelled": "Appointment cancelled",
    "booking.completed": "Appointment completed",
    "booking.arrived": `${clientLabel} checked in`,
    "booking.no_show": "Marked as no-show",
    "payment.payment": "Payment recorded",
    "payment.refund": "Refund recorded",
    "payment.gift_card": "Gift card redeemed",
    "payment.gift_card_refund": "Gift card refunded",
    "payment.corrected": "Payment updated",
    "payment.deleted": "Payment deleted",
  };
  return labels[eventType] ?? eventType.replaceAll(/[._]/g, " ");
}

function settlement(row: SaleRow) {
  if (row.status === "cancelled") return { label: "Cancelled", detail: "No checkout", tone: "is-cancelled" };
  if (row.packageRedeemed) return { label: "Package", detail: "Service visit redeemed", tone: "is-paid" };
  const balance = row.bookedPriceCents + row.noShowChargeCents - row.paidCents;
  if (balance === 0) return { label: "Paid", detail: `${money(row.paidCents)} collected`, tone: "is-paid" };
  if (balance > 0) return { label: "Open", detail: `${money(balance)} due`, tone: "is-open" };
  return { label: "Credit due", detail: `${money(-balance)} to refund`, tone: "is-refund" };
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ location?: string; q?: string; status?: string; sale?: string; page?: string; sort?: string; activity?: string } & TableDateParams> }) {
  const { location: rawLocation, q, status, sale, page: rawPage, sort, activity: paymentActivity, from, to } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requirePageFeature(tenant.id, "booking-essentials");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager) redirect(tenantPath(tenantSlug, "/app"));

  const terminology = await getTenantTerminology(tenant);
  const clientLabel = titleTerminology(terminology.client);
  const db = tenantDb(tenant);
  const location = typeof rawLocation === "string" && uuidPattern.test(rawLocation) ? rawLocation : undefined;
  const saleId = typeof sale === "string" && uuidPattern.test(sale) ? sale : undefined;
  const requestedPage = typeof rawPage === "string" && /^[1-9]\d{0,8}$/.test(rawPage) ? Number(rawPage) : 1;
  const selectedStatus = status && saleStatuses.includes(status) ? status : "all";
  const search = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const pattern = `%${search}%`;
  const selectedSort = saleSortOptions.find(({ value }) => value === sort)?.value ?? defaultSaleSort;
  const selectedActivity = paymentActivity === "with" || paymentActivity === "without" ? paymentActivity : "all";
  const dates = tableDateFilters({ from, to }, tenant.timezone);
  const sortingPayments = selectedSort === "payment-newest" || selectedSort === "payment-oldest";
  const sortDirection = selectedSort === defaultSaleSort ? "other" : selectedSort.endsWith("-oldest") ? "ascending" : "descending";
  const sortOrder = {
    "appointment-today": tableDateOrder(db, "startsAt", "bookingId", dates),
    "appointment-newest": db`"startsAt" DESC, "bookingId" DESC`,
    "appointment-oldest": db`"startsAt" ASC, "bookingId" ASC`,
    "payment-newest": db`"lastPaymentAt" DESC NULLS LAST, "startsAt" DESC, "bookingId" DESC`,
    "payment-oldest": db`"lastPaymentAt" ASC NULLS LAST, "startsAt" ASC, "bookingId" ASC`,
  }[selectedSort];
  const saleRows = db`
      SELECT cs.id, cs.currency, b.id AS "bookingId", b.booking_number AS "bookingNumber", b.customer_id AS "customerId", b.starts_at AS "startsAt", b.status, b.booked_price_cents AS "bookedPriceCents", b.no_show_charge_cents AS "noShowChargeCents",
        coalesce(sum(CASE WHEN pr.kind = 'payment' THEN pr.amount_cents ELSE -pr.amount_cents END), 0)::int AS "paidCents",
        count(pr.id)::int AS "paymentCount", max(pr.recorded_at) AS "lastPaymentAt",
        c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone", s.title AS "serviceTitle",
        b.team_member_id AS "teamMemberId", tm.name AS "teamMemberName", b.location_id AS "locationId", l.name AS "locationName"
        ,exists(SELECT 1 FROM commerce_entitlement_entries ce WHERE ce.tenant_id=cs.tenant_id AND ce.booking_id=b.id AND ce.kind='redeem' AND ce.package_id IS NOT NULL) AS "packageRedeemed"
        ,exists(SELECT 1 FROM payment_records gp WHERE gp.tenant_id=cs.tenant_id AND gp.booking_id=b.id AND gp.method='gift_card' AND gp.kind='payment') AS "giftCardRedeemed"
      FROM commerce_sales cs
      JOIN bookings b ON b.id = cs.booking_id AND b.tenant_id = cs.tenant_id
      JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
      LEFT JOIN team_members tm ON tm.id = b.team_member_id AND tm.tenant_id = b.tenant_id
      LEFT JOIN payment_records pr ON pr.booking_id = b.id AND pr.tenant_id = b.tenant_id
      WHERE cs.tenant_id = ${tenant.id}`;
  const groupSales = db`GROUP BY cs.id, b.id, c.id, s.id, l.id, tm.id`;
  const statusFilter = selectedStatus === "all" ? db`TRUE` : db`settlement_status = ${selectedStatus}`;
  const [locations, results, products, [selectedSale]] = await Promise.all([
    db<Location[]>`SELECT id, name FROM locations WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY CASE WHEN slug = 'primary' THEN 0 ELSE 1 END, name`,
    db<((SaleRow | { id: null }) & SaleSummary)[]>`
      WITH scoped AS (
        ${saleRows}
          ${location ? db`AND b.location_id = ${location}` : db``}
          ${search ? db`AND (c.name ILIKE ${pattern} OR s.title ILIKE ${pattern})` : db``}
        ${dateRangeWhere(db, "b.starts_at", dates)}
        ${groupSales}
      ), classified AS (
        SELECT *, CASE
          WHEN status = 'cancelled' THEN 'cancelled'
          WHEN "packageRedeemed" OR "bookedPriceCents" + "noShowChargeCents" = "paidCents" THEN 'paid'
          WHEN "bookedPriceCents" + "noShowChargeCents" > "paidCents" THEN 'open'
          ELSE 'refund'
        END AS settlement_status
        FROM scoped
        WHERE ${selectedActivity === "all" ? db`TRUE` : db`("lastPaymentAt" IS NOT NULL) = ${selectedActivity === "with"}`}
      ), totals AS (
        SELECT count(*) FILTER (WHERE ${statusFilter})::int AS "matchingCount",
          coalesce(sum(greatest(0, "bookedPriceCents" + "noShowChargeCents" - "paidCents"))
            FILTER (WHERE status <> 'cancelled' AND NOT "packageRedeemed"), 0) AS "outstandingCents",
          coalesce(sum("paidCents"), 0) AS "collectedCents",
          coalesce(sum(greatest(0, "paidCents" - "bookedPriceCents" - "noShowChargeCents"))
            FILTER (WHERE status <> 'cancelled' AND NOT "packageRedeemed"), 0) AS "refundDueCents"
        FROM classified
      ), pagination AS (
        SELECT totals.*, least(${requestedPage}::int, greatest(1, ("matchingCount" + ${salesPageSize} - 1) / ${salesPageSize})) AS page
        FROM totals
      ), visible_sales AS (
        SELECT * FROM classified WHERE ${statusFilter}
        ORDER BY ${sortOrder}
        LIMIT ${salesPageSize}
        OFFSET (SELECT (page - 1) * ${salesPageSize} FROM pagination)
      )
      SELECT visible_sales.*, pagination.* FROM pagination LEFT JOIN visible_sales ON TRUE
      ORDER BY ${sortOrder}
    `,
    db<Product[]>`SELECT id,title,price_cents AS "priceCents",currency FROM commerce_catalog_items WHERE tenant_id=${tenant.id} AND kind='product' AND is_active=TRUE ORDER BY title`,
    saleId ? db<SaleRow[]>`${saleRows} AND cs.id = ${saleId} ${groupSales}` : [],
  ]);
  const selectedLocation = locations.find((item) => item.id === location);
  const sales = results.filter((row) => row.id !== null);
  const { outstandingCents, collectedCents, refundDueCents, matchingCount, page } = results[0];
  const [paymentBalance, paymentItems] = selectedSale ? await Promise.all([
    getAppointmentPaymentBalance(db, tenant.id, selectedSale.bookingId),
    db<PaymentItem[]>`
      SELECT p.id, p.kind, p.amount_cents AS "amountCents", p.method, p.recorded_at AS "recordedAt",
        EXISTS(SELECT 1 FROM booking_events e WHERE e.tenant_id = p.tenant_id AND e.booking_id = p.booking_id
          AND e.event_type IN ('payment.corrected', 'payment.deleted') AND e.metadata->>'adjustmentId' = p.id::text) AS adjustment
      FROM payment_records p WHERE p.tenant_id = ${tenant.id} AND p.booking_id = ${selectedSale.bookingId}
      ORDER BY p.recorded_at DESC, p.id DESC
    `,
  ]) : [null, []] as const;
  const saleLines = selectedSale ? await db<SaleLine[]>`
    SELECT id,title_snapshot AS title,unit_price_cents AS "unitPriceCents",quantity,discount_cents AS "discountCents"
    FROM commerce_sale_lines WHERE tenant_id=${tenant.id} AND sale_id=${selectedSale.id} AND line_kind='product' ORDER BY created_at
  ` : [];
  const activity = selectedSale ? await db<BookingActivity[]>`
    SELECT id, event_type AS "eventType", actor_identity_id AS "actorIdentityId", created_at AS "createdAt"
    FROM booking_events WHERE tenant_id=${tenant.id} AND booking_id=${selectedSale.bookingId}
    ORDER BY created_at DESC, id DESC LIMIT 100
  ` : [];
  const actorIds = [...new Set(activity.flatMap((event) => event.actorIdentityId ? [event.actorIdentityId] : []))];
  const actors = actorIds.length ? await controlDb<ActivityActor[]>`
    SELECT i.id, i.display_name AS "displayName" FROM identities i
    JOIN tenant_memberships m ON m.identity_id=i.id AND m.tenant_id=${tenant.id}
    WHERE i.id = ANY(${actorIds}::uuid[])
  ` : [];
  const actorNames = new Map(actors.map((actor) => [actor.id, actor.displayName]));
  const eligiblePackages = selectedSale && !selectedSale.packageRedeemed ? await db<EligiblePackage[]>`
    SELECT cp.id,cp.title_snapshot AS title,cp.expires_at AS "expiresAt",
      coalesce(sum(CASE WHEN ce.direction='credit' THEN ce.units ELSE -ce.units END),0)::int AS "remainingUnits"
    FROM commerce_packages cp
    JOIN commerce_entitlement_entries ce ON ce.package_id=cp.id AND ce.tenant_id=cp.tenant_id
    WHERE cp.tenant_id=${tenant.id} AND cp.customer_id=${selectedSale.customerId ?? ""} AND cp.status='active'
      AND (cp.expires_at IS NULL OR cp.expires_at > now())
      AND EXISTS (SELECT 1 FROM commerce_package_service_entitlements pe WHERE pe.tenant_id=cp.tenant_id AND pe.catalog_item_id=cp.catalog_item_id AND pe.service_id=(SELECT service_id FROM bookings WHERE id=${selectedSale.bookingId} AND tenant_id=${tenant.id}))
    GROUP BY cp.id HAVING coalesce(sum(CASE WHEN ce.direction='credit' THEN ce.units ELSE -ce.units END),0) > 0
    ORDER BY cp.created_at
  ` : [];
  const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const salesPath = tenantPath(tenantSlug, "/app/sales");
  const saleListParams = dateFilterParams(new URLSearchParams(), dates);
  if (location) saleListParams.set("location", location);
  if (search) saleListParams.set("q", search);
  if (selectedStatus !== "all") saleListParams.set("status", selectedStatus);
  if (selectedActivity !== "all") saleListParams.set("activity", selectedActivity);
  if (selectedSort !== defaultSaleSort) saleListParams.set("sort", selectedSort);
  const listHref = (pageNumber: number) => {
    const params = new URLSearchParams(saleListParams);
    if (pageNumber > 1) params.set("page", String(pageNumber));
    return `${salesPath}${params.size ? `?${params}` : ""}`;
  };
  const saleListHref = listHref(page);
  const saleHref = (row: SaleRow) => {
    const params = new URLSearchParams(saleListParams);
    if (page > 1) params.set("page", String(page));
    params.set("sale", row.id);
    return `${salesPath}?${params}`;
  };
  const checkoutHref = (row: SaleRow) => {
    if (!row.teamMemberId) {
      const params = new URLSearchParams({ booking: row.bookingId, q: row.bookingNumber });
      return `${tenantPath(tenantSlug, "/app/bookings")}?${params}`;
    }
    const day = tenantDateKey(row.startsAt, tenant.timezone);
    const params = new URLSearchParams({ employee: row.teamMemberId, booking: row.bookingId, week: weekStartForLocalDate(day), day, view: "staff" });
    if (row.locationId) params.set("location", row.locationId);
    return `${tenantPath(tenantSlug, "/app/calendars")}?${params}`;
  };

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="sales" />
    <section className="reports-intro"><div><h1>Sales</h1></div><Link className="waybook-primary-link" href={tenantPath(tenantSlug, "/app/sales/retail")}>New checkout</Link></section>
    <section className="waybook-data-metrics reports-metrics">
      <article><span>Open balance</span><strong>{money(Number(outstandingCents))}</strong></article>
      <article><span>Collected</span><strong>{money(Number(collectedCents))}</strong></article>
      <article><span>Credit due</span><strong>{money(Number(refundDueCents))}</strong></article>
    </section>
    <section className="waybook-data-card">
      <h2>Appointment checkouts</h2>
      <form action={salesPath} method="get" className="waybook-list-filter sales-filters">
        <label>Location<select name="location" defaultValue={selectedLocation?.id ?? ""}>
          <option value="">All locations</option>
          {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Status<select name="status" defaultValue={selectedStatus}>
          <option value="all">All sales</option><option value="open">Open balance</option>
          <option value="paid">Paid</option><option value="refund">Credit due</option><option value="cancelled">Cancelled</option>
        </select></label>
        <label>Payment activity<select name="activity" defaultValue={selectedActivity}>
          <option value="all">Any payment activity</option>
          <option value="with">With payment activity</option>
          <option value="without">No payment activity</option>
        </select></label>
        <label>Sort by<select name="sort" defaultValue={selectedSort}>
          {saleSortOptions.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <TableDateFields dates={dates} label="Appointment date range" withSort={false} />
        <label>Search<input name="q" type="search" defaultValue={search} placeholder={`${clientLabel} or service`} /></label>
        <button type="submit">Apply</button>
      </form>
      <div className="waybook-table-wrap"><table>
        <thead><tr><th>Sale</th><th>Status</th><th aria-sort={sortingPayments ? undefined : sortDirection}>Appointment date</th><th>{clientLabel}</th><th>Service</th><th>Total</th><th aria-sort={sortingPayments ? sortDirection : undefined}>Payments</th></tr></thead>
        <tbody>{sales.map((row) => {
          const state = settlement(row);
          const href = saleHref(row);
          return <BookingListRow key={row.id} href={href} className={selectedSale?.id === row.id ? "is-selected" : undefined}>
            <td><Link className="waybook-row-link" href={href}>Appointment · {row.serviceTitle}</Link><small>{row.locationName ?? "No location"}</small></td>
            <td><b className={`sales-status ${state.tone}`}>{state.label}</b><small>{state.detail}</small></td>
            <td>{dateTime.format(row.startsAt)}</td><td>{row.customerName}</td><td>{row.serviceTitle}</td>
            <td>{money(row.bookedPriceCents + row.noShowChargeCents)}</td>
            <td>{row.paymentCount ? money(row.paidCents) : "No entries"}{row.lastPaymentAt ? <small>Last entry {dateTime.format(row.lastPaymentAt)}</small> : null}</td>
          </BookingListRow>;
        })}{sales.length === 0 ? <tr><td colSpan={7}>No appointment sales match these filters.</td></tr> : null}</tbody>
      </table></div>
      {matchingCount > salesPageSize ? <nav className="waybook-list-filter sales-pagination" aria-label="Appointment sales pages">
        <span>Showing {(page - 1) * salesPageSize + 1}–{Math.min(page * salesPageSize, matchingCount)} of {matchingCount}</span>
        {page > 1 ? <Link href={listHref(page - 1)}>Previous page</Link> : null}
        {page * salesPageSize < matchingCount ? <Link href={listHref(page + 1)}>Next page</Link> : null}
      </nav> : null}
    </section>
    {selectedSale ? (() => {
      const state = settlement(selectedSale);
      const balance = selectedSale.packageRedeemed ? 0 : selectedSale.bookedPriceCents + selectedSale.noShowChargeCents - selectedSale.paidCents;
      const productTotalCents = saleLines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity - line.discountCents, 0);
      const activeAppointment = ["confirmed", "arrived"].includes(selectedSale.status);
      const canAddProducts = activeAppointment && products.length > 0;
      const outstandingCents = selectedSale.status === "cancelled" ? 0 : Math.max(balance, 0);
      const recorded = paymentBalance?.payments ?? [];
      const canRedeemPackage = activeAppointment && paymentItems.length === 0 && eligiblePackages.length > 0;
      return <TenantEditorDialog key={selectedSale.id} title="Appointment checkout" closeHref={saleListHref} cycleFocus dismissSuccessToastOnClose>
        <aside className="tenant-drawer appointment-drawer sale-detail appointment-sale-drawer" data-drawer-inline-actions aria-label={`Sale details for ${selectedSale.customerName}`}>
          <header><div><p>{state.label} SALE</p><h2>Appointment checkout</h2><span>{dateTime.format(selectedSale.startsAt)}</span></div><TenantEditorClose href={saleListHref} label="Close sale details">Close</TenantEditorClose></header>
          <div className="appointment-drawer__body">
            <Link className="waybook-primary-link sale-detail__action" href={checkoutHref(selectedSale)}>Open appointment</Link>
            <section className="sale-detail__summary"><div><span>{clientLabel}</span><strong>{selectedSale.customerName}</strong><small>{selectedSale.locationName ?? "No location"}</small></div><div><span>Service</span><strong>{selectedSale.serviceTitle}</strong><small>{selectedSale.teamMemberName ?? `No assigned ${terminology.staffMember}`}</small></div></section>
            <section><h3>Totals</h3><dl className="sale-detail__totals">
              <div><dt>Booked service</dt><dd>{money(selectedSale.bookedPriceCents)}</dd></div>
              {selectedSale.noShowChargeCents > 0 ? <div><dt>No-show fee</dt><dd>{money(selectedSale.noShowChargeCents)}</dd></div> : null}
              {saleLines.map((line) => <div key={line.id}><dt>{line.title} × {line.quantity}</dt><dd>{money(line.unitPriceCents * line.quantity - line.discountCents)}</dd></div>)}
              {saleLines.length > 0 ? <div><dt>Products pending checkout</dt><dd>{money(productTotalCents)}</dd></div> : null}
              <div><dt>Net payments</dt><dd>{money(selectedSale.paidCents)}</dd></div>
              {selectedSale.status !== "cancelled" ? <div className={balance === 0 ? "is-settled" : balance < 0 ? "is-credit" : ""}>
                <dt>{balance < 0 ? "Credit due" : "Service balance"}</dt><dd>{money(Math.abs(balance))}</dd>
              </div> : null}
            </dl></section>
            {paymentBalance && (recorded.length > 0 || outstandingCents > 0) ? <section><h3>Payment details</h3>
              {recorded.length > 0
                ? <RecordedAppointmentPayments bookingId={selectedSale.bookingId} payments={recorded} allowEdit={selectedSale.status !== "cancelled"} />
                : <AppointmentPaymentForm bookingId={selectedSale.bookingId} balance={paymentBalance} secondary />}
            </section> : null}
            {selectedSale.status !== "cancelled" ? <section><h3>{clientLabel} details</h3>
              <SaleAppointmentDetailsForm bookingId={selectedSale.bookingId} name={selectedSale.customerName} email={selectedSale.customerEmail} phone={selectedSale.customerPhone ?? ""} />
            </section> : null}
            {canAddProducts ? <section><h3>Products</h3><form action={addProductToAppointmentSale} className="tenant-drawer-form">
              <input type="hidden" name="saleId" value={selectedSale.id} />
              <div className="tenant-drawer-form__grid">
                <label>Product<select name="productId" defaultValue="" required><option value="" disabled>Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title} · {money(product.priceCents)}</option>)}</select></label>
                <label>Quantity<input name="quantity" type="number" min={1} max={99} defaultValue={1} required /></label>
              </div>
              <button className="waybook-action waybook-action--secondary" type="submit">Add product</button>
            </form></section> : null}
            {selectedSale.packageRedeemed || activeAppointment ? <section><h3>Package</h3>
              {selectedSale.packageRedeemed ? <p className="sale-detail__note">A package visit has been redeemed.</p> : canRedeemPackage ? <form action={redeemPackageForAppointmentSale} className="tenant-drawer-form">
                <input type="hidden" name="saleId" value={selectedSale.id} />
                <label>Eligible {terminology.client} package<select name="packageId" required defaultValue=""><option value="" disabled>Select package</option>{eligiblePackages.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.remainingUnits} visit{item.remainingUnits === 1 ? "" : "s"} remaining{item.expiresAt ? ` · expires ${new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium" }).format(item.expiresAt)}` : ""}</option>)}</select></label>
                <button className="waybook-action waybook-action--secondary" type="submit">Redeem package visit</button>
              </form> : <p className="sale-detail__note">No eligible package can be redeemed.</p>}
            </section> : null}
            {selectedSale.giftCardRedeemed || (activeAppointment && recorded.length === 0 && outstandingCents > 0 && selectedSale.currency === "DKK") ? <section><h3>Gift card</h3>
              {selectedSale.giftCardRedeemed ? <p className="sale-detail__note">A gift card has been used for this appointment.</p> : <GiftCardTenderForm saleId={selectedSale.id} balanceCents={outstandingCents} />}
            </section> : null}
            <section><h3>Transactions</h3>{paymentItems.length ? <ul className="client-record__ledger">{paymentItems.map((item) => <li key={item.id}><div><strong>{item.adjustment ? "Payment adjustment" : item.kind === "refund" ? "Refund" : "Payment"} · {item.method.replaceAll("_", " ")}</strong><span>{dateTime.format(item.recordedAt)}</span></div><b className={item.kind === "refund" ? "is-refund" : undefined}>{item.kind === "refund" ? "−" : "+"}{money(item.amountCents)}</b></li>)}</ul> : <p className="sale-detail__note">No transactions yet.</p>}</section>
            {activity.length > 0 ? <section><h3>Appointment activity</h3><ul className="client-record__ledger">{activity.map((event) => <li key={event.id}><div><strong>{activityLabel(event.eventType, clientLabel)}</strong><span>{dateTime.format(event.createdAt)} · {event.actorIdentityId ? actorNames.get(event.actorIdentityId) ?? "Team member" : "Actor not recorded"}</span></div></li>)}</ul>{activity.length === 100 ? <p className="sale-detail__note">Showing the 100 most recent events.</p> : null}</section> : null}
          </div>
        </aside>
      </TenantEditorDialog>;
    })() : null}
  </main>;
}
