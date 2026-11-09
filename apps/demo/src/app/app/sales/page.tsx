import Link from "next/link";
import { redirect } from "next/navigation";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { tenantDateKey, weekStartForLocalDate } from "@/lib/waybook/today-command-centre";
import { addProductToAppointmentSale, redeemPackageForAppointmentSale } from "./actions";

type SaleRow = {
  id: string;
  bookingId: string;
  customerId: string;
  startsAt: Date;
  status: string;
  bookedPriceCents: number;
  paidCents: number;
  paymentCount: number;
  customerName: string;
  serviceTitle: string;
  teamMemberId: string | null;
  teamMemberName: string | null;
  locationId: string | null;
  locationName: string | null;
  packageRedeemed: boolean;
};
type Location = { id: string; name: string };
type Product = { id: string; title: string; priceCents: number; currency: string };
type SaleLine = { id: string; title: string; unitPriceCents: number; quantity: number; discountCents: number };
type PaymentItem = { id: string; kind: "payment" | "refund"; amountCents: number; method: string; notes: string | null; recordedAt: Date };
type EligiblePackage = { id: string; title: string; remainingUnits: number; expiresAt: Date | null };

const money = (cents: number) => new Intl.NumberFormat("en-DK", { style: "currency", currency: "DKK", maximumFractionDigits: 0 }).format(cents / 100);

function settlement(row: SaleRow) {
  if (row.status === "cancelled") return { label: "Cancelled", detail: "No checkout", tone: "is-cancelled" };
  if (row.packageRedeemed) return { label: "Package", detail: "Service visit redeemed", tone: "is-paid" };
  const balance = row.bookedPriceCents - row.paidCents;
  if (balance === 0) return { label: "Paid", detail: `${money(row.paidCents)} collected`, tone: "is-paid" };
  if (balance > 0) return { label: "Open", detail: `${money(balance)} due`, tone: "is-open" };
  return { label: "Credit due", detail: `${money(-balance)} to refund`, tone: "is-refund" };
}

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ location?: string; q?: string; status?: string; sale?: string }> }) {
  const { location, q, status, sale } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager) redirect(tenantPath(tenantSlug, "/app"));

  const db = tenantDb(tenant);
  const search = (q ?? "").trim().slice(0, 100);
  const pattern = `%${search}%`;
  const [locations, rows, products] = await Promise.all([
    db<Location[]>`SELECT id, name FROM locations WHERE tenant_id = ${tenant.id} AND is_active = TRUE ORDER BY CASE WHEN slug = 'primary' THEN 0 ELSE 1 END, name`,
    db<SaleRow[]>`
      SELECT cs.id, b.id AS "bookingId", b.customer_id AS "customerId", b.starts_at AS "startsAt", b.status, b.booked_price_cents AS "bookedPriceCents",
        coalesce(sum(CASE WHEN pr.kind = 'payment' THEN pr.amount_cents ELSE -pr.amount_cents END), 0)::int AS "paidCents",
        count(pr.id)::int AS "paymentCount", c.name AS "customerName", s.title AS "serviceTitle",
        b.team_member_id AS "teamMemberId", tm.name AS "teamMemberName", b.location_id AS "locationId", l.name AS "locationName"
        ,exists(SELECT 1 FROM commerce_entitlement_entries ce WHERE ce.tenant_id=cs.tenant_id AND ce.booking_id=b.id AND ce.kind='redeem' AND ce.package_id IS NOT NULL) AS "packageRedeemed"
      FROM commerce_sales cs
      JOIN bookings b ON b.id = cs.booking_id AND b.tenant_id = cs.tenant_id
      JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
      LEFT JOIN team_members tm ON tm.id = b.team_member_id AND tm.tenant_id = b.tenant_id
      LEFT JOIN payment_records pr ON pr.booking_id = b.id AND pr.tenant_id = b.tenant_id
      WHERE cs.tenant_id = ${tenant.id}
        ${location ? db`AND b.location_id = ${location}` : db``}
        ${search ? db`AND (c.name ILIKE ${pattern} OR s.title ILIKE ${pattern})` : db``}
      GROUP BY cs.id, b.id, c.id, s.id, l.id, tm.id
      ORDER BY b.starts_at DESC
      LIMIT 150
    `,
    db<Product[]>`SELECT id,title,price_cents AS "priceCents",currency FROM commerce_catalog_items WHERE tenant_id=${tenant.id} AND kind='product' AND is_active=TRUE ORDER BY title`,
  ]);
  const selectedLocation = locations.find((item) => item.id === location);
  const selectedStatus: string = ["all", "open", "paid", "refund", "cancelled"].includes(status ?? "") ? status ?? "all" : "all";
  const sales = rows.filter((row) => selectedStatus === "all" || settlement(row).tone === `is-${selectedStatus}`);
  const selectedSale = rows.find((row) => row.id === sale) ?? null;
  const paymentItems = selectedSale ? await db<PaymentItem[]>`
    SELECT id, kind, amount_cents AS "amountCents", method, notes, recorded_at AS "recordedAt"
    FROM payment_records
    WHERE tenant_id = ${tenant.id} AND booking_id = ${selectedSale.bookingId}
    ORDER BY recorded_at DESC
  ` : [];
  const saleLines = selectedSale ? await db<SaleLine[]>`
    SELECT id,title_snapshot AS title,unit_price_cents AS "unitPriceCents",quantity,discount_cents AS "discountCents"
    FROM commerce_sale_lines WHERE tenant_id=${tenant.id} AND sale_id=${selectedSale.id} AND line_kind='product' ORDER BY created_at
  ` : [];
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
  const activeSales = rows.filter((row) => row.status !== "cancelled");
  const outstandingCents = activeSales.reduce((sum, row) => sum + (row.packageRedeemed ? 0 : Math.max(0, row.bookedPriceCents - row.paidCents)), 0);
  const collectedCents = rows.reduce((sum, row) => sum + row.paidCents, 0);
  const refundDueCents = activeSales.reduce((sum, row) => sum + (row.packageRedeemed ? 0 : Math.max(0, row.paidCents - row.bookedPriceCents)), 0);
  const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const salesPath = tenantPath(tenantSlug, "/app/sales");
  const saleListParams = new URLSearchParams();
  if (location) saleListParams.set("location", location);
  if (search) saleListParams.set("q", search);
  if (selectedStatus !== "all") saleListParams.set("status", selectedStatus);
  const saleListHref = `${salesPath}${saleListParams.size ? `?${saleListParams}` : ""}`;
  const saleHref = (row: SaleRow) => {
    const params = new URLSearchParams(saleListParams);
    params.set("sale", row.id);
    return `${salesPath}?${params}`;
  };
  const checkoutHref = (row: SaleRow) => {
    if (!row.teamMemberId) return null;
    const params = new URLSearchParams({ employee: row.teamMemberId, booking: row.bookingId, week: weekStartForLocalDate(tenantDateKey(row.startsAt, tenant.timezone)) });
    if (row.locationId) params.set("location", row.locationId);
    return `${tenantPath(tenantSlug, "/app/calendars")}?${params}`;
  };

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="sales" />
    <section className="reports-intro"><div><p>SALES · DATABASE-BACKED</p><h1>Checkout</h1><span>Appointment-led sales and immutable payment entries for {tenant.name}.</span></div><Link className="waybook-primary-link" href={tenantPath(tenantSlug, "/app/sales/retail")}>New checkout</Link></section>
    <section className="waybook-data-metrics reports-metrics">
      <article><span>Open balance</span><strong>{money(outstandingCents)}</strong><small>Outstanding across non-cancelled appointments</small></article>
      <article><span>Collected</span><strong>{money(collectedCents)}</strong><small>Payments less refunds on the loaded sales</small></article>
      <article><span>Credit due</span><strong>{money(refundDueCents)}</strong><small>Overpayments that need a refund entry</small></article>
    </section>
    <section className="waybook-data-card">
      <div className="waybook-section-heading"><div><p>SALES</p><h2>Appointment checkouts</h2><span>Open a sale to collect payment or record a refund against its appointment. Entries append to the immutable ledger.</span></div><form method="get" className="waybook-list-filter"><label>Location<select name="location" defaultValue={selectedLocation?.id ?? ""}><option value="">All locations</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Status<select name="status" defaultValue={selectedStatus}><option value="all">All sales</option><option value="open">Open balance</option><option value="paid">Paid</option><option value="refund">Credit due</option><option value="cancelled">Cancelled</option></select></label><label>Search<input name="q" type="search" defaultValue={search} placeholder="Client or service" /></label><button type="submit">Apply</button></form></div>
      <div className="waybook-table-wrap"><table><thead><tr><th>Sale</th><th>Status</th><th>Date</th><th>Client</th><th>Service</th><th>Total</th><th>Payments</th></tr></thead><tbody>{sales.map((row) => { const state = settlement(row); const saleName = `Appointment · ${row.serviceTitle}`; return <tr key={row.id} className={selectedSale?.id === row.id ? "is-selected" : undefined}><td><Link className="waybook-row-link" href={saleHref(row)}>{saleName}</Link><small>{row.locationName ?? "No location"}</small></td><td><b className={`sales-status ${state.tone}`}>{state.label}</b><small>{state.detail}</small></td><td><Link className="waybook-row-link" href={saleHref(row)}>{dateTime.format(row.startsAt)}</Link></td><td>{row.customerName}</td><td>{row.serviceTitle}</td><td>{money(row.bookedPriceCents)}</td><td>{row.paymentCount ? money(row.paidCents) : "No entries"}<small>{row.paymentCount ? `${row.paymentCount} ledger ${row.paymentCount === 1 ? "entry" : "entries"}` : "Open to checkout"}</small></td></tr>; })}{sales.length === 0 ? <tr><td colSpan={7}>No appointment sales match these filters.</td></tr> : null}</tbody></table></div>
    </section>
    {selectedSale ? (() => {
      const state = settlement(selectedSale);
      const balance = selectedSale.packageRedeemed ? 0 : selectedSale.bookedPriceCents - selectedSale.paidCents;
      const productTotalCents = saleLines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity - line.discountCents, 0);
      const appointmentHref = checkoutHref(selectedSale);
      const canAddProducts = ["confirmed", "arrived"].includes(selectedSale.status) && products.length > 0;
      return <div className="tenant-drawer-layer" role="presentation">
        <Link className="tenant-drawer-scrim" href={saleListHref} aria-label="Close sale details" />
        <aside className="tenant-drawer appointment-drawer sale-detail" aria-label={`Sale details for ${selectedSale.customerName}`}>
          <header><div><p>{state.label} SALE</p><h2>Appointment checkout</h2><span>{dateTime.format(selectedSale.startsAt)}</span></div><Link className="tenant-drawer-close" href={saleListHref} aria-label="Close sale details">Close</Link></header>
          <div className="appointment-drawer__body">
            <section className="sale-detail__summary"><div><span>Client</span><strong>{selectedSale.customerName}</strong><small>{selectedSale.locationName ?? "No location"}</small></div><div><span>Service</span><strong>{selectedSale.serviceTitle}</strong><small>{selectedSale.teamMemberName ?? "No assigned staff"}</small></div></section>
            <section><h3>Sale total</h3><dl className="sale-detail__totals"><div><dt>Booked service</dt><dd>{money(selectedSale.bookedPriceCents)}</dd></div>{saleLines.map((line) => <div key={line.id}><dt>{line.title} × {line.quantity}</dt><dd>{money(line.unitPriceCents * line.quantity - line.discountCents)}</dd></div>)}<div><dt>Products</dt><dd>{money(productTotalCents)}</dd></div><div><dt>Payments received</dt><dd>{money(selectedSale.paidCents)}</dd></div><div className={balance === 0 ? "is-settled" : balance < 0 ? "is-credit" : ""}><dt>{balance < 0 ? "Credit due" : balance === 0 ? "Service balance" : "Service outstanding"}</dt><dd>{money(Math.abs(balance))}</dd></div></dl></section>
            <section><h3>Products</h3>{canAddProducts ? <form action={addProductToAppointmentSale} className="tenant-drawer-form"><input type="hidden" name="saleId" value={selectedSale.id} /><div className="tenant-drawer-form__grid"><label>Product<select name="productId" required><option value="" disabled>Select product</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title} · {money(product.priceCents)}</option>)}</select></label><label>Quantity<input name="quantity" type="number" min={1} max={99} defaultValue={1} required /></label></div><p className="tenant-drawer-note">Products are priced snapshots. They can be added only before the appointment reaches a terminal status; tendering remains a later checkout step.</p><button type="submit">Add product</button></form> : <p className="tenant-drawer-note">Products can be added only to confirmed or arrived appointments with an active product catalogue. Completed, cancelled, and no-show appointments are read-only.</p>}</section>
            <section><h3>Package</h3>{selectedSale.packageRedeemed ? <p className="tenant-drawer-note">A package visit has been redeemed for this appointment. The debit is immutable; cancellation/reversal needs its dedicated lifecycle.</p> : ["confirmed", "arrived"].includes(selectedSale.status) && selectedSale.paidCents === 0 && eligiblePackages.length ? <form action={redeemPackageForAppointmentSale} className="tenant-drawer-form"><input type="hidden" name="saleId" value={selectedSale.id} /><label>Eligible client package<select name="packageId" required defaultValue=""><option value="" disabled>Select package</option>{eligiblePackages.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.remainingUnits} visit{item.remainingUnits === 1 ? "" : "s"} remaining{item.expiresAt ? ` · expires ${new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium" }).format(item.expiresAt)}` : ""}</option>)}</select></label><p className="tenant-drawer-note">Redeems one matching visit and settles this service appointment. Package and payment tender cannot be mixed yet.</p><button type="submit">Redeem package visit</button></form> : <p className="tenant-drawer-note">No eligible package can be redeemed. Redemptions require a confirmed or arrived appointment, no payment entries, and a matching active client package with visits remaining.</p>}</section>
            <section><h3>Transactions</h3>{paymentItems.length ? <ul className="client-record__ledger">{paymentItems.map((item) => <li key={item.id}><div><strong>{item.kind === "refund" ? "Refund" : "Payment"} · {item.method.replaceAll("_", " ")}</strong><span>{dateTime.format(item.recordedAt)}{item.notes ? ` · ${item.notes}` : ""}</span></div><b className={item.kind === "refund" ? "is-refund" : undefined}>{item.kind === "refund" ? "−" : "+"}{money(item.amountCents)}</b></li>)}</ul> : <p className="tenant-drawer-note">No payment entries have been recorded for this appointment.</p>}</section>
            <section><h3>Sale details</h3><p className="sale-detail__note">This sale is generated from the appointment. Open it to collect payment, issue a refund, or manage the booking; all changes stay in the immutable ledger.</p></section>
            {appointmentHref ? <Link className="waybook-primary-link sale-detail__action" href={appointmentHref}>Open appointment</Link> : null}
          </div>
        </aside>
      </div>;
    })() : null}
  </main>;
}
