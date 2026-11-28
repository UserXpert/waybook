import { ListFilterOptions } from "@/components/workspace-options";
import { TableDateFields } from "@/components/table-date-fields";
import { hasTableDateFilters, dateFilterParams, dateRangeWhere, tableDateFilters, tableDateOrder, type TableDateParams } from "@/lib/waybook/table-date-filters";
import { notFound } from "next/navigation";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";
import Link from "next/link";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requirePageFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { addProductToRetailCheckout, closeRetailCheckout, createRetailCheckout } from "./actions";
import { ClientPicker } from "@/components/client-picker";
import { RetailCheckoutForm } from "@/components/retail-checkout-form";
import { StripeOnboardingButton } from "@/components/stripe-onboarding-button";
import { PracticePaymentCheck } from "./practice-payment-check";
import { startStripeSandboxRehearsal } from "../../settings/payment-actions";

type Product = { id: string; title: string; sku: string | null; priceCents: number; currency: string };
type RetailSale = { id: string; customerName: string; isPractice: boolean; hasPracticeSession: boolean; status: string; currency: string; createdAt: Date; totalCents: number };
type RetailLine = { id: string; title: string; unitPriceCents: number; quantity: number; discountCents: number };
type RetailTransaction = { method: string; amountCents: number; recordedAt: Date };
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-DK", { style: "currency", currency, minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100);
const salesPageSize = 100;
const uuidPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export default async function RetailCheckoutPage({ searchParams }: { searchParams: Promise<{ sale?: string; page?: string; sandbox?: string } & TableDateParams> }) {
  const { sale, page: rawPage, sort, from, to, sandbox } = await searchParams;
  const saleId = typeof sale === "string" && uuidPattern.test(sale) ? sale : null;
  const requestedPage = typeof rawPage === "string" && /^[1-9]\d{0,8}$/.test(rawPage) ? Number(rawPage) : 1;
  const { tenant, membership } = await requireTenantWorkspace();
  await requirePageFeature(tenant.id, "booking-essentials");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  if (!(await staffPermissionContext(tenant, membership)).isManager) notFound();
  const terminology = await getTenantTerminology(tenant);
  const clientLabel = titleTerminology(terminology.client);
  const db = tenantDb(tenant);
  const dateTime = new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" });
  const dates = tableDateFilters({ sort, from, to }, tenant.timezone);
  const dateRange = dateRangeWhere(db, "cs.created_at", dates);
  const dateOrder = tableDateOrder(db, "cs.created_at", "cs.id", dates);
  const retailScope = db`
    FROM commerce_sales cs
    LEFT JOIN customers c ON c.id=cs.customer_id AND c.tenant_id=cs.tenant_id
    WHERE cs.tenant_id=${tenant.id} AND cs.booking_id IS NULL AND cs.stripe_practice_cleared_at IS NULL
      AND (cs.is_stripe_practice OR c.id IS NOT NULL)
  `;
  const saleDetails = db`
    SELECT cs.id, coalesce(c.name, 'Stripe sandbox') AS "customerName", cs.is_stripe_practice AS "isPractice",
      cs.stripe_practice_session_id IS NOT NULL AS "hasPracticeSession", cs.status, cs.currency, cs.created_at AS "createdAt",
      (SELECT coalesce(sum((sl.unit_price_cents * sl.quantity) - sl.discount_cents),0)::int
        FROM commerce_sale_lines sl WHERE sl.sale_id=cs.id AND sl.tenant_id=cs.tenant_id) AS "totalCents"
    ${retailScope}
  `;
  const [products, [total], selectedSales] = await Promise.all([
    db<Product[]>`SELECT id,title,sku,price_cents AS "priceCents",currency FROM commerce_catalog_items WHERE tenant_id=${tenant.id} AND kind='product' AND is_active=TRUE ORDER BY title`,
    db<{ count: number }[]>`SELECT count(*)::int AS count ${retailScope} ${dateRange}`,
    saleId ? db<RetailSale[]>`${saleDetails} AND cs.id=${saleId}` : [],
  ]);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total.count / salesPageSize)));
  const offset = (page - 1) * salesPageSize;
  const [sales, lines, transactions] = await Promise.all([
    db<RetailSale[]>`${saleDetails} ${dateRange} ORDER BY ${dateOrder} LIMIT ${salesPageSize} OFFSET ${offset}`,
    selectedSales.length ? db<RetailLine[]>`SELECT id,title_snapshot AS title,unit_price_cents AS "unitPriceCents",quantity,discount_cents AS "discountCents" FROM commerce_sale_lines WHERE tenant_id=${tenant.id} AND sale_id=${saleId} ORDER BY created_at` : [],
    selectedSales.length ? db<RetailTransaction[]>`SELECT method,amount_cents AS "amountCents",recorded_at AS "recordedAt" FROM commerce_sale_transactions WHERE tenant_id=${tenant.id} AND sale_id=${saleId} ORDER BY recorded_at DESC` : [],
  ]);
  const selected = selectedSales[0];
  const path = tenantPath(tenantSlug, "/app/sales/retail");
  const listHref = (pageNumber: number, id?: string) => {
    const params = dateFilterParams(new URLSearchParams(), dates);
    if (pageNumber > 1) params.set("page", String(pageNumber));
    if (id) params.set("sale", id);
    return params.size ? `${path}?${params}` : path;
  };
  const closeHref = listHref(page);
  const saleHref = (id: string) => listHref(page, id);
  return <main className="waybook-data-page tenant-dashboard-page retail-checkout-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="sales" />
    <section className="reports-intro"><div><p>SALES · RETAIL</p><h1>Retail sales</h1></div><Link className="waybook-primary-link" href={tenantPath(tenantSlug, "/app/sales")}>Appointment sales</Link></section>
    <section className="waybook-data-card retail-checkout-page__new">
      <div className="waybook-section-heading"><h2>New checkout</h2></div>
      <RetailCheckoutForm action={createRetailCheckout} submitLabel="Create draft">
        <ClientPicker name="customerId" terminology={terminology} required />
        <label>Product
          <select name="productId" required defaultValue="">
            <option value="" disabled>Select product</option>
            {products.map((item) => <option key={item.id} value={item.id}>
              {item.title}{item.sku ? ` · ${item.sku}` : ""} · {money(item.priceCents, item.currency)}
            </option>)}
          </select>
        </label>
        <label>Quantity<input name="quantity" type="number" defaultValue={1} min={1} max={99} required /></label>
      </RetailCheckoutForm>
    </section>
    <section className="waybook-data-card">
      <div className="waybook-section-heading workspace-filter-bar">
        <h2>Recent checkouts</h2>
        <ListFilterOptions label="Retail checkouts" active={hasTableDateFilters(dates)} clearHref={path}>
          <TableDateFields dates={dates} label="Created date range" />
        </ListFilterOptions>
      </div>
      <div className="waybook-table-wrap retail-checkout-history">
        <table>
          <thead><tr>
            <th scope="col">Checkout</th>
            <th scope="col" className="retail-checkout-history__wide">{clientLabel}</th>
            <th scope="col">Status</th>
            <th scope="col">Total</th>
            <th scope="col" className="retail-checkout-history__wide">Created</th>
          </tr></thead>
          <tbody>{sales.map((item) => <tr key={item.id} className={selected?.id === item.id ? "is-selected" : undefined}>
            <td>
              <Link className="waybook-row-link" href={saleHref(item.id)}>{item.isPractice ? "Practice sale" : "Retail checkout"}</Link>
              <span className="retail-checkout-history__compact">
                <span>{item.customerName}</span>
                <time dateTime={item.createdAt.toISOString()}>{dateTime.format(item.createdAt)}</time>
              </span>
            </td>
            <td className="retail-checkout-history__wide">{item.customerName}</td>
            <td><b className={`sales-status ${item.status === "closed" ? "is-paid" : "is-open"}`}>
              {item.status === "closed" ? "Paid" : item.status === "draft" ? "Draft" : item.status}
            </b></td>
            <td>{money(item.totalCents, item.currency)}</td>
            <td className="retail-checkout-history__wide">{dateTime.format(item.createdAt)}</td>
          </tr>)}{sales.length === 0 ? <tr><td colSpan={5}>No retail checkouts yet.</td></tr> : null}</tbody>
        </table>
      </div>
      {total.count > salesPageSize ? <nav className="waybook-list-filter sales-pagination" aria-label="Retail checkout pages">
        <span>Showing {offset + 1}–{Math.min(offset + salesPageSize, total.count)} of {total.count}</span>
        {page > 1 ? <Link href={listHref(page - 1)}>Previous page</Link> : null}
        {offset + salesPageSize < total.count ? <Link href={listHref(page + 1)}>Next page</Link> : null}
      </nav> : null}
    </section>
    {selected ? <TenantEditorDialog key={selected.id} title="Retail checkout details" closeHref={closeHref} cycleFocus dismissSuccessToastOnClose><aside className="tenant-drawer appointment-drawer sale-detail retail-checkout-drawer" aria-label="Retail checkout details"><header><div><p>{selected.isPractice ? "PRACTICE SALE" : `${selected.status.toUpperCase()} CHECKOUT`}</p><h2>{selected.customerName}</h2><span>{money(selected.totalCents, selected.currency)} · {lines.length} line{lines.length === 1 ? "" : "s"}</span></div><TenantEditorClose href={closeHref} label="Close checkout">Close</TenantEditorClose></header><div className="appointment-drawer__body"><section><h3>Items</h3><ul className="client-record__ledger">{lines.map((line) => <li key={line.id}><div><strong>{line.title}</strong><span>{line.quantity} × {money(line.unitPriceCents, selected.currency)}</span></div><b>{money((line.unitPriceCents * line.quantity) - line.discountCents, selected.currency)}</b></li>)}</ul></section>{selected.status === "draft" && selected.isPractice ? <section>
      <h3>Stripe sandbox payment</h3>
      {sandbox === "payment-unavailable" ? <p role="alert">Stripe status is temporarily unavailable.</p> : null}
      {sandbox === "payment-pending" || sandbox === "payment-cancelled" ? <p role="status">No completed test payment has been confirmed.</p> : null}
      {membership.role === "owner" ? <>
        {selected.hasPracticeSession ? <PracticePaymentCheck saleId={selected.id} returned={sandbox === "payment-returned"} /> : <form action={startStripeSandboxRehearsal}>
          <input type="hidden" name="nonce" value={selected.id} />
          <StripeOnboardingButton label="Open test checkout" />
        </form>}
      </> : null}
    </section> : selected.status === "draft" ? <><section><h3>Add product</h3><RetailCheckoutForm action={addProductToRetailCheckout} submitLabel="Add item"><input type="hidden" name="saleId" value={selected.id} />{page > 1 ? <input type="hidden" name="page" value={page} /> : null}<label>Product<select name="productId" required defaultValue=""><option value="" disabled>Select product</option>{products.map((item) => <option key={item.id} value={item.id}>{item.title} · {money(item.priceCents, item.currency)}</option>)}</select></label><label>Quantity<input name="quantity" type="number" defaultValue={1} min={1} max={99} required /></label></RetailCheckoutForm></section><section><h3>Collect payment</h3><RetailCheckoutForm action={closeRetailCheckout} submitLabel={`Collect ${money(selected.totalCents, selected.currency)}`}><input type="hidden" name="saleId" value={selected.id} />{page > 1 ? <input type="hidden" name="page" value={page} /> : null}<input type="hidden" name="totalCents" value={selected.totalCents} /><label>Method<select name="method" defaultValue="card"><option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label></RetailCheckoutForm><p className="sale-detail__note">Record a payment already taken. This closes the sale.</p></section></> : <section><h3>{selected.isPractice ? "Completed test payment" : "Collected payment"}</h3><ul className="client-record__ledger">{transactions.map((item, index) => <li key={`${item.recordedAt.toISOString()}-${index}`}><div><strong>{item.method.replaceAll("_", " ")}</strong><span>{dateTime.format(item.recordedAt)}</span></div><b>{money(item.amountCents, selected.currency)}</b></li>)}</ul></section>}</div></aside></TenantEditorDialog> : null}
  </main>;
}
