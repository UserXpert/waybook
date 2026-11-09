import Link from "next/link";
import { FormToggle } from "@/components/form-toggle";
import { TableRowLink } from "@/components/table-row-link";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { saveProduct } from "./actions";

type Product = { id: string; title: string; description: string | null; sku: string | null; priceCents: number; currency: string; isActive: boolean; photoDataUrl: string | null; createdAt: Date };

const formatMoney = (cents: number, currency: string) => new Intl.NumberFormat("en-DK", { style: "currency", currency, maximumFractionDigits: 0 }).format(cents / 100);

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ product?: string; new?: string; q?: string }> }) {
  const { product, new: createNew, q } = await searchParams;
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager) throw new Error("You do not have permission to view products.");
  const search = (q ?? "").trim().slice(0, 100);
  const db = tenantDb(tenant);
  const products = await db<Product[]>`
    SELECT id, title, description, sku, price_cents AS "priceCents", currency, is_active AS "isActive", metadata->>'photoDataUrl' AS "photoDataUrl", created_at AS "createdAt"
    FROM commerce_catalog_items
    WHERE tenant_id = ${tenant.id} AND kind = 'product'
      ${search ? db`AND (title ILIKE ${`%${search}%`} OR sku ILIKE ${`%${search}%`})` : db``}
    ORDER BY is_active DESC, title
  `;
  const selected = products.find((item) => item.id === product) ?? null;
  const productsPath = tenantPath(tenantSlug, "/app/products");
  const panelOpen = Boolean(selected || createNew === "1");

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="products" />
    <section className="reports-intro"><div><p>CATALOGUE · DATABASE-BACKED</p><h1>Products</h1><span>Retail items that can be added to a sale. Services remain managed separately because they control booking availability.</span></div></section>
    <section className="waybook-data-card">
      <div className="waybook-section-heading"><div><h2>Retail catalogue</h2><p>Products are tenant-scoped and auditable. Gift cards, packages, and memberships will use this same catalogue foundation when their redemption flows are delivered.</p></div><Link className="waybook-primary-link" href={`${productsPath}?new=1`}>Add product</Link></div>
      <form method="get" className="waybook-list-filter"><label>Search<input name="q" type="search" defaultValue={search} placeholder="Product name or SKU" /></label><button type="submit">Apply</button></form>
      <div className="waybook-table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Status</th><th>Added</th></tr></thead><tbody>{products.map((item) => <TableRowLink key={item.id} href={`${productsPath}?product=${item.id}${search ? `&q=${encodeURIComponent(search)}` : ""}`} label={`Open ${item.title}`}><td><div className="catalogue-row">{item.photoDataUrl ? <img src={item.photoDataUrl} alt="" /> : null}<span><strong>{item.title}</strong><small>{item.description ?? "No description"}</small></span></div></td><td>{item.sku ?? "—"}</td><td>{formatMoney(item.priceCents, item.currency)}</td><td><b className={`sales-status ${item.isActive ? "is-paid" : "is-cancelled"}`}>{item.isActive ? "Active" : "Inactive"}</b></td><td>{new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium" }).format(item.createdAt)}</td></TableRowLink>)}{products.length === 0 ? <tr><td colSpan={5}>No products yet. Add retail items here before adding them to a standalone checkout.</td></tr> : null}</tbody></table></div>
    </section>
    {panelOpen ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" href={productsPath} aria-label="Close product editor" /><aside className="tenant-drawer" aria-label={selected ? "Edit product" : "Add product"}><header><div><p>CATALOGUE</p><h2>{selected ? "Edit product" : "Add product"}</h2><span>Product changes apply only to future retail sale lines.</span></div><Link className="tenant-drawer-close" href={productsPath} aria-label="Close product editor">Close</Link></header><form action={saveProduct} className="tenant-drawer-form"><input type="hidden" name="productId" value={selected?.id ?? ""} /><label>Product name<input name="title" defaultValue={selected?.title ?? ""} maxLength={140} required /></label><label>SKU<input name="sku" defaultValue={selected?.sku ?? ""} maxLength={80} placeholder="Optional" /></label><label>Description<textarea name="description" defaultValue={selected?.description ?? ""} maxLength={1000} rows={4} /></label><label>Price<input name="priceDkk" type="number" min="0" max="100000" step="1" defaultValue={(selected?.priceCents ?? 0) / 100} required /></label><label>Product photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>{selected?.photoDataUrl ? <><img className="catalogue-photo-preview" src={selected.photoDataUrl} alt="Current product" /><label className="tenant-drawer-check"><input type="checkbox" name="removePhoto" /> Remove photo</label></> : null}<FormToggle name="isActive" label="Available at checkout" defaultChecked={selected?.isActive ?? true} /><button type="submit">Save product</button></form></aside></div> : null}
  </main>;
}
