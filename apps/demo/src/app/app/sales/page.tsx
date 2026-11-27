import Link from "next/link";
import { redirect } from "next/navigation";
import { hasNonGiftCardPayment } from "@/lib/waybook/appointment-payment-records";
import { getAppointmentSaleProducts, getAppointmentSalePayments } from "@/lib/waybook/appointment-sale-details";
import { getAppointmentPaymentBalance } from "@/lib/waybook/appointment-payment-balance";
import { RecordedAppointmentPayments } from "@/components/recorded-appointment-payments";
import { AppointmentPaymentForm } from "@/components/appointment-payment-form";
import { StripeAppointmentPayment } from "@/components/stripe-appointment-payment";
import { StripeAppointmentRefund } from "@/components/stripe-appointment-refund";
import { FinishAppointmentCheckout } from "@/components/appointment-attendance-journey";
import type { AppointmentAttendanceStage } from "@/lib/waybook/appointment-lifecycle";
import { TableDateFields } from "@/components/table-date-fields";
import { dateFilterParams, dateRangeWhere, tableDateFilters, tableDateOrder, type TableDateParams } from "@/lib/waybook/table-date-filters";
import { BookingListRow } from "@/components/booking-list-controls";
import { SaleAppointmentDetailsForm } from "@/components/sale-appointment-details-form";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { GiftCardTenderForm } from "@/components/gift-card-tender-form";
import { controlDb, tenantDb } from "@/lib/waybook/database";
import { requirePageFeature } from "@/lib/waybook/features";
import { appointmentCheckoutAccess } from "@/lib/waybook/appointment-checkout-access";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { appointmentStripeAccount, appointmentStripeConfig, appointmentStripeState } from "@/lib/waybook/stripe-appointment-checkout";
import { stripeAppointmentRefundDetails } from "@/lib/waybook/stripe-appointment-refunds";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { getAdditionalAppointmentServices } from "@/lib/waybook/appointment-service-segments";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { addProductToAppointmentSale, redeemPackageForAppointmentSale, removeProductFromAppointmentSale } from "./actions";

type SaleRow = {
  id: string;
  bookingId: string;
  bookingNumber: string;
  customerId: string;
  currency: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  attendanceStage: AppointmentAttendanceStage | null;
  bookedPriceCents: number;
  noShowChargeCents: number;
  paidCents: number;
  stripeRefundedCents: number;
  chargeableCents: number;
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
type EligiblePackage = { id: string; title: string; remainingUnits: number; expiresAt: Date | null };
type BookingActivity = { id: string; eventType: string; actorIdentityId: string | null; createdAt: Date; providerRecorded: boolean };
type ActivityActor = { id: string; displayName: string };
type SaleSummary = { outstandingCents: string; collectedCents: string; refundDueCents: string; matchingCount: number; page: number };

const salesPageSize = 150;
const saleStatuses = ["all", "open", "paid", "refund", "refunded", "cancelled"];
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
    "booking.services_updated": "Appointment services updated",
    "booking.cancelled": "Appointment cancelled",
    "booking.completed": "Appointment completed",
    "booking.arrived": `${clientLabel} checked in`,
    "booking.waiting_room": "Checked in to waiting room",
    "booking.waiting_room_providers_notified": "Waiting room alert sent",
    "booking.in_service": "Service started",
    "booking.checking_out": "Checkout opened",
    "booking.no_show": "Marked as no-show",
    "payment.payment": "Payment recorded",
    "payment.refund": "Refund recorded",
    "payment.refund_returned": "Stripe returned a refund",
    "payment.gift_card": "Gift card redeemed",
    "payment.gift_card_refund": "Gift card refunded",
    "payment.corrected": "Payment updated",
    "payment.deleted": "Payment deleted",
    "commerce.product_added": "Product added",
    "commerce.product_removed": "Product removed",
  };
  return labels[eventType] ?? eventType.replaceAll(/[._]/g, " ");
}

function settlement(row: SaleRow) {
  if (row.status === "cancelled") return { label: "Cancelled", detail: "No checkout", tone: "is-cancelled" };
  if (row.stripeRefundedCents > 0) return { label: row.paidCents > 0 ? "Partially refunded" : "Refunded",
    detail: `${money(row.stripeRefundedCents)} returned`, tone: "is-refund" };
  const balance = row.chargeableCents - row.paidCents;
  if (row.packageRedeemed && row.chargeableCents === 0) return { label: "Package", detail: "Service visit redeemed", tone: "is-paid" };
  if (balance === 0) return { label: "Paid", detail: `${money(row.paidCents)} collected`, tone: "is-paid" };
  if (balance > 0) return { label: "Open", detail: `${money(balance)} due`, tone: "is-open" };
  return { label: "Credit due", detail: `${money(-balance)} to refund`, tone: "is-refund" };
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ location?: string; q?: string; status?: string; sale?: string; booking?: string; step?: string; tender?: string; page?: string; sort?: string; activity?: string; stripe?: string } & TableDateParams> }) {
  const { location: rawLocation, q, status, sale, booking, step, tender, page: rawPage, sort, activity: paymentActivity, from, to, stripe } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requirePageFeature(tenant.id, "booking-essentials");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const permissions = await staffPermissionContext(tenant, membership);
  const manager = permissions.isManager;
  const calendarPath = tenantPath(tenantSlug, "/app/calendars");

  const terminology = await getTenantTerminology(tenant);
  const clientLabel = titleTerminology(terminology.client);
  const db = tenantDb(tenant);
  const location = typeof rawLocation === "string" && uuidPattern.test(rawLocation) ? rawLocation : undefined;
  const saleId = typeof sale === "string" && uuidPattern.test(sale) ? sale : undefined;
  const bookingId = typeof booking === "string" && uuidPattern.test(booking) ? booking : undefined;
  if (!manager && (!permissions.canCheckoutAppointments || (!saleId && !bookingId))) {
    redirect(tenantPath(tenantSlug, "/app"));
  }
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
      SELECT cs.id, cs.currency, b.id AS "bookingId", b.booking_number AS "bookingNumber", b.customer_id AS "customerId", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.attendance_stage AS "attendanceStage", b.booked_price_cents AS "bookedPriceCents", b.no_show_charge_cents AS "noShowChargeCents",
        coalesce(sum(CASE WHEN pr.kind = 'payment' THEN pr.amount_cents ELSE -pr.amount_cents END), 0)::int AS "paidCents",
        coalesce(sum(CASE pr.kind WHEN 'refund' THEN pr.amount_cents ELSE -pr.amount_cents END) FILTER (WHERE EXISTS (
          SELECT 1 FROM booking_events e WHERE e.tenant_id = pr.tenant_id AND e.booking_id = pr.booking_id
            AND e.event_type IN ('payment.refund', 'payment.refund_returned') AND e.metadata->>'paymentId' = pr.id::text
            AND e.metadata->>'source' = 'stripe_sandbox'
        )), 0)::int AS "stripeRefundedCents",
        count(pr.id)::int AS "paymentCount", max(pr.recorded_at) AS "lastPaymentAt",
        c.name AS "customerName", c.email AS "customerEmail", c.phone AS "customerPhone", s.title AS "serviceTitle",
        b.team_member_id AS "teamMemberId", tm.name AS "teamMemberName", b.location_id AS "locationId", l.name AS "locationName"
        ,cart.package_redeemed AS "packageRedeemed",cart.chargeable_cents::int AS "chargeableCents"
        ,exists(SELECT 1 FROM payment_records gp WHERE gp.tenant_id=cs.tenant_id AND gp.booking_id=b.id AND gp.method='gift_card' AND gp.kind='payment') AS "giftCardRedeemed"
      FROM commerce_sales cs
      JOIN bookings b ON b.id = cs.booking_id AND b.tenant_id = cs.tenant_id
      JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
      LEFT JOIN team_members tm ON tm.id = b.team_member_id AND tm.tenant_id = b.tenant_id
      CROSS JOIN LATERAL appointment_checkout_amounts(b.tenant_id, b.id) cart
      LEFT JOIN payment_records pr ON pr.booking_id = b.id AND pr.tenant_id = b.tenant_id
      WHERE cs.tenant_id = ${tenant.id}`;
  const groupSales = db`GROUP BY cs.id, b.id, c.id, s.id, l.id, tm.id, cart.package_redeemed, cart.chargeable_cents`;
  const statusFilter = selectedStatus === "all" ? db`TRUE` : db`settlement_status = ${selectedStatus}`;
  const [locations, results, products, [selectedSale]] = await Promise.all([
    manager ? db<Location[]>`SELECT id, name FROM locations WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY CASE WHEN slug = 'primary' THEN 0 ELSE 1 END, name` : [],
    manager ? db<((SaleRow | { id: null }) & SaleSummary)[]>`
      WITH scoped AS (
        ${saleRows}
          ${location ? db`AND b.location_id = ${location}` : db``}
          ${search ? db`AND (c.name ILIKE ${pattern} OR s.title ILIKE ${pattern})` : db``}
        ${dateRangeWhere(db, "b.starts_at", dates)}
        ${groupSales}
      ), classified AS (
        SELECT *, CASE
          WHEN status = 'cancelled' THEN 'cancelled'
          WHEN "stripeRefundedCents" > 0 THEN 'refunded'
          WHEN "chargeableCents" = "paidCents" THEN 'paid'
          WHEN "chargeableCents" > "paidCents" THEN 'open'
          ELSE 'refund'
        END AS settlement_status
        FROM scoped
        WHERE ${selectedActivity === "all" ? db`TRUE` : db`("lastPaymentAt" IS NOT NULL) = ${selectedActivity === "with"}`}
      ), totals AS (
        SELECT count(*) FILTER (WHERE ${statusFilter})::int AS "matchingCount",
          coalesce(sum(greatest(0, "chargeableCents" - "paidCents"))
            FILTER (WHERE status <> 'cancelled' AND "stripeRefundedCents" = 0), 0) AS "outstandingCents",
          coalesce(sum("paidCents"), 0) AS "collectedCents",
          coalesce(sum(greatest(0, "paidCents" - "chargeableCents"))
            FILTER (WHERE status <> 'cancelled'), 0) AS "refundDueCents"
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
    ` : [] as ((SaleRow | { id: null }) & SaleSummary)[],
    manager ? db<Product[]>`SELECT id,title,price_cents AS "priceCents",currency FROM commerce_catalog_items WHERE tenant_id=${tenant.id} AND kind='product' AND is_active=TRUE ORDER BY title` : [],
    saleId || bookingId ? db<SaleRow[]>`
      ${saleRows}
      AND ${saleId ? db`cs.id = ${saleId}` : db`cs.booking_id = ${bookingId!}`}
      AND ${appointmentCheckoutAccess(db, permissions)}
      ${manager ? db`` : db`AND (b.status = 'completed' OR (b.status = 'arrived' AND b.attendance_stage = 'checking_out'))`}
      ${groupSales}
    ` : [],
  ]);
  if (!manager && !selectedSale) redirect(calendarPath);
  const selectedLocation = locations.find((item) => item.id === location);
  const sales = results.filter((row): row is SaleRow & SaleSummary => row.id !== null);
  const { outstandingCents, collectedCents, refundDueCents, matchingCount, page } = results[0] ?? { outstandingCents: 0, collectedCents: 0, refundDueCents: 0, matchingCount: 0, page: 1 };
  const saleContext = { db, tenantId: tenant.id };
  const [paymentBalance, paymentItems, saleLines] = selectedSale ? await Promise.all([
    getAppointmentPaymentBalance(db, tenant.id, selectedSale.bookingId),
    manager ? getAppointmentSalePayments(saleContext, selectedSale.bookingId) : [],
    getAppointmentSaleProducts(saleContext, selectedSale.id),
  ]) : [null, [], []] as const;
  const additionalServiceLines = selectedSale ? await getAdditionalAppointmentServices(db, tenant.id, selectedSale.bookingId) : [];
  const activity = manager && selectedSale ? await db<BookingActivity[]>`
    SELECT id, event_type AS "eventType", actor_identity_id AS "actorIdentityId", created_at AS "createdAt",
      metadata->>'recordedVia' = 'stripe' AS "providerRecorded"
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
  const eligiblePackages = manager && selectedSale && !selectedSale.packageRedeemed ? await db<EligiblePackage[]>`
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
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, hour: "2-digit", minute: "2-digit" });
  const [stripeState, stripeAccount, stripeRefund] = selectedSale && appointmentStripeConfig() ? await Promise.all([
    appointmentStripeState({ db, tenantId: tenant.id, bookingId: selectedSale.bookingId }),
    manager ? appointmentStripeAccount(tenant.id) : null,
    manager && ["completed", "cancelled"].includes(selectedSale.status) && paymentBalance?.payments.some((payment) => payment.stripeSandbox)
      ? stripeAppointmentRefundDetails({ db, tenantId: tenant.id, bookingId: selectedSale.bookingId })
      : null,
  ]) : [null, null, null];
  const stripePending = stripeState === "pending";
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
  const saleHref = (row: SaleRow) => {
    if (!manager) return `${salesPath}?booking=${row.bookingId}`;
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

  const saleListHref = !manager && selectedSale ? checkoutHref(selectedSale) : listHref(page);

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active={manager ? "sales" : "calendars"} />
    {manager ? <>
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
          <option value="paid">Paid</option><option value="refund">Credit due</option><option value="refunded">Refunded</option><option value="cancelled">Cancelled</option>
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
            <td>{money(row.chargeableCents)}</td>
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
    </> : null}
    {selectedSale ? (() => {
      const state = settlement(selectedSale);
      const balance = selectedSale.chargeableCents - selectedSale.paidCents;
      const activeAppointment = ["confirmed", "arrived"].includes(selectedSale.status);
      const canChangeProducts = manager && activeAppointment && paymentItems.length === 0 && !stripePending;
      const availableProducts = products.filter((product) => product.currency === selectedSale.currency);
      const outstandingCents = selectedSale.status === "cancelled" ? 0 : Math.max(balance, 0);
      const recorded = paymentBalance?.payments ?? [];
      const canRecordPayment = (manager || (selectedSale.attendanceStage === "checking_out" && !stripePending)) && paymentBalance && !hasNonGiftCardPayment(recorded) && outstandingCents > 0;
      const paymentStep = step === "payment" && Boolean(canRecordPayment);
      const reviewHref = saleHref(selectedSale);
      const paymentHref = `${reviewHref}&step=payment`;
      const canUseGiftCard = manager && !stripePending && activeAppointment && !selectedSale.giftCardRedeemed && recorded.length === 0 && canRecordPayment && selectedSale.currency === "DKK";
      const giftCardStep = canUseGiftCard && tender === "gift-card";
      const canRedeemPackage = activeAppointment && paymentItems.length === 0 && eligiblePackages.length > 0 && !stripePending;
      const canStartStripe = Boolean(stripeAccount) && selectedSale.attendanceStage === "checking_out" &&
        selectedSale.currency === "DKK" && paymentItems.length === 0;
      const bookedServices = [{
        id: selectedSale.bookingId, title: selectedSale.serviceTitle, provider: selectedSale.teamMemberName,
        startsAt: selectedSale.startsAt, endsAt: selectedSale.endsAt, priceCents: selectedSale.bookedPriceCents,
      }, ...additionalServiceLines];
      return <TenantEditorDialog key={selectedSale.id} title="Appointment checkout" closeHref={saleListHref} cycleFocus dismissSuccessToastOnClose>
        <aside className="tenant-drawer appointment-drawer sale-detail appointment-sale-drawer" data-drawer-inline-actions aria-label={`Sale details for ${selectedSale.customerName}`}>
          <header><div><p>{state.label} SALE</p><h2>Appointment checkout</h2><span>{dateTime.format(selectedSale.startsAt)}</span></div><TenantEditorClose href={saleListHref} label="Close sale details">Close</TenantEditorClose></header>
          <div className="appointment-drawer__body">
            {paymentStep ? <Link className="waybook-action waybook-action--secondary sale-detail__action" href={reviewHref}>Back to checkout</Link> : null}
            <section className="appointment-checkout__client" aria-label={clientLabel}>
              <div><span>{clientLabel}</span><strong>{selectedSale.customerName}</strong></div>
              {selectedSale.locationName ? <small>{selectedSale.locationName}</small> : null}
            </section>
            {!paymentStep ? <section aria-label="Checkout items" className="appointment-checkout__items">
              <h3>Checkout items</h3>
              <ul>
                {bookedServices.map((line) => <li key={line.id}>
                  <div>
                    <strong>{line.title}</strong>
                    <small>{clock.format(new Date(line.startsAt))}–{clock.format(new Date(line.endsAt))}
                      {line.provider ? ` · ${line.provider}` : ` · No assigned ${terminology.staffMember}`}</small>
                  </div>
                  <b>{money(line.priceCents)}</b>
                </li>)}
                {selectedSale.noShowChargeCents > 0 ? <li><strong>No-show fee</strong><b>{money(selectedSale.noShowChargeCents)}</b></li> : null}
                {saleLines.map((line) => <li key={line.id}>
                  <strong>{line.title} × {line.quantity}</strong><b>{money(line.unitPriceCents * line.quantity - line.discountCents)}</b>
                </li>)}
              </ul>
            </section> : null}
            <section aria-label="Checkout totals"><h3>Totals</h3><dl className="sale-detail__totals">
              {selectedSale.packageRedeemed ? <div><dt>Package coverage</dt><dd>−{money(selectedSale.bookedPriceCents)}</dd></div> : null}
              <div><dt>Checkout total</dt><dd>{money(selectedSale.chargeableCents)}</dd></div>
              <div><dt>Net payments</dt><dd>{money(selectedSale.paidCents)}</dd></div>
              {selectedSale.stripeRefundedCents > 0 ? <div><dt>Refunds issued</dt><dd>{money(selectedSale.stripeRefundedCents)}</dd></div> :
                selectedSale.status !== "cancelled" ? <div className={balance === 0 ? "is-settled" : balance < 0 ? "is-credit" : ""}>
                <dt>{balance < 0 ? "Credit due" : "Balance due"}</dt><dd>{money(Math.abs(balance))}</dd>
              </div> : null}
            </dl>
              {!manager && stripePending ? <p className="sale-detail__note" role="status">
                A card payment is in progress. Ask a manager to review it before taking another payment.
              </p> : null}
              {!paymentStep && canRecordPayment ? <Link className="waybook-primary-link sale-detail__action" href={paymentHref}>Go to payments</Link> : null}
              {!paymentStep && selectedSale.attendanceStage === "checking_out" && !stripePending && (balance === 0 || (manager && selectedSale.stripeRefundedCents > 0)) ? <FinishAppointmentCheckout bookingId={selectedSale.bookingId} /> : null}
            </section>
            {paymentStep && paymentBalance ? <section><h3>{giftCardStep ? "Gift card" : "Payments"}</h3>
              {giftCardStep ? <>
                <GiftCardTenderForm saleId={selectedSale.id} balanceCents={outstandingCents} />
                <Link className="waybook-action waybook-action--secondary sale-detail__action" href={paymentHref}>Other payment methods</Link>
              </> : <>
                {manager && (stripePending || canStartStripe) ? <StripeAppointmentPayment bookingId={selectedSale.bookingId}
                  amountCents={outstandingCents} pendingPayment={stripePending} verifyOnReturn={stripe === "return"} /> : null}
                {!stripePending ? <AppointmentPaymentForm bookingId={selectedSale.bookingId} balance={paymentBalance} checkout requireFullBalance={!manager}
                  giftCardHref={canUseGiftCard ? `${paymentHref}&tender=gift-card` : undefined} /> : null}
              </>}
            </section> : null}
            {!paymentStep && recorded.length > 0 ? <section><h3>Payment details</h3>
              <RecordedAppointmentPayments bookingId={selectedSale.bookingId} payments={recorded} allowEdit={manager && selectedSale.status !== "cancelled"} />
              {stripeRefund ? <StripeAppointmentRefund bookingId={selectedSale.bookingId} requestId={crypto.randomUUID()} {...stripeRefund} /> : null}
            </section> : null}
            {!paymentStep ? <>
              {manager && selectedSale.status !== "cancelled" ? <section><h3>{clientLabel} details</h3>
                <SaleAppointmentDetailsForm bookingId={selectedSale.bookingId} name={selectedSale.customerName} email={selectedSale.customerEmail} phone={selectedSale.customerPhone ?? ""} />
              </section> : null}
              {canChangeProducts && (availableProducts.length > 0 || saleLines.length > 0) ? <section><h3>Products</h3>
                {saleLines.map((line) => <form key={line.id} action={removeProductFromAppointmentSale} className="tenant-drawer-form">
                  <input type="hidden" name="saleId" value={selectedSale.id} />
                  <input type="hidden" name="lineId" value={line.id} />
                  <button className="waybook-action waybook-action--secondary" type="submit">Remove {line.title}</button>
                </form>)}
                {availableProducts.length > 0 ? <form action={addProductToAppointmentSale} className="tenant-drawer-form">
                <input type="hidden" name="saleId" value={selectedSale.id} />
                <div className="tenant-drawer-form__grid">
                  <label>Product<select name="productId" defaultValue="" required><option value="" disabled>Select product</option>{availableProducts.map((product) => <option key={product.id} value={product.id}>{product.title} · {money(product.priceCents)}</option>)}</select></label>
                  <label>Quantity<input name="quantity" type="number" min={1} max={99} defaultValue={1} required /></label>
                </div>
                <button className="waybook-action waybook-action--secondary" type="submit">Add product</button>
              </form> : null}</section> : null}
              {manager && (selectedSale.packageRedeemed || activeAppointment) ? <section><h3>Package</h3>
                {selectedSale.packageRedeemed ? <p className="sale-detail__note">A package visit has been redeemed.</p> : canRedeemPackage ? <form action={redeemPackageForAppointmentSale} className="tenant-drawer-form">
                  <input type="hidden" name="saleId" value={selectedSale.id} />
                  <label>Eligible {terminology.client} package<select name="packageId" required defaultValue=""><option value="" disabled>Select package</option>{eligiblePackages.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.remainingUnits} visit{item.remainingUnits === 1 ? "" : "s"} remaining{item.expiresAt ? ` · expires ${new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium" }).format(item.expiresAt)}` : ""}</option>)}</select></label>
                  <button className="waybook-action waybook-action--secondary" type="submit">Redeem package visit</button>
                </form> : <p className="sale-detail__note">No eligible package can be redeemed.</p>}
              </section> : null}
              {selectedSale.giftCardRedeemed ? <section><h3>Gift card</h3>
                <p className="sale-detail__note">A gift card has been used for this appointment.</p>
              </section> : null}
              {manager && selectedSale.status === "completed" && paymentItems.some((item) => item.kind === "payment") ?
                <Link className="waybook-action waybook-action--secondary sale-detail__action"
                  href={tenantPath(tenantSlug, `/app/sales/receipt?sale=${selectedSale.id}`)}>View receipt</Link> : null}
              <Link className="waybook-action waybook-action--secondary sale-detail__action" href={checkoutHref(selectedSale)}>Open appointment</Link>
              {manager ? <section><h3>Transactions</h3>{paymentItems.length ? <ul className="client-record__ledger">{paymentItems.map((item) => <li key={item.id}><div><strong>{item.refundReturned ? "Refund returned" : item.adjustment ? "Payment adjustment" : item.kind === "refund" ? "Refund" : "Payment"} · {item.method.replaceAll("_", " ")}</strong><span>{dateTime.format(item.recordedAt)}</span></div><b className={item.kind === "refund" ? "is-refund" : undefined}>{item.kind === "refund" ? "−" : "+"}{money(item.amountCents)}</b></li>)}</ul> : <p className="sale-detail__note">No transactions yet.</p>}</section> : null}
              {activity.length > 0 ? <section><h3>Appointment activity</h3><ul className="client-record__ledger">{activity.map((event) => <li key={event.id}><div><strong>{activityLabel(event.eventType, clientLabel)}</strong><span>{dateTime.format(event.createdAt)} · {event.providerRecorded ? "Stripe sandbox" : event.actorIdentityId ? actorNames.get(event.actorIdentityId) ?? "Team member" : "Actor not recorded"}</span></div></li>)}</ul>{activity.length === 100 ? <p className="sale-detail__note">Showing the 100 most recent events.</p> : null}</section> : null}
            </> : null}
          </div>
        </aside>
      </TenantEditorDialog>;
    })() : null}
  </main>;
}
