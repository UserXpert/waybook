import Link from "next/link";
import { FormToggle } from "@/components/form-toggle";
import { TableRowLink } from "@/components/table-row-link";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { ProductEditor } from "@/components/product-editor";
import { readCatalogueMetadata } from "@/lib/waybook/catalogue-media";

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
  const selectedId = product && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(product) ? product.toLowerCase() : null;
  const db = tenantDb(tenant);
  const matchesSearch = search ? db`(title ILIKE ${`%${search}%`} OR sku ILIKE ${`%${search}%`})` : db`TRUE`;
  const rows = await db<(Omit<Product, "photoDataUrl"> & { metadata: unknown; matchesSearch: boolean })[]>`
    SELECT id, title, description, sku, price_cents AS "priceCents", currency, is_active AS "isActive", metadata, created_at AS "createdAt", COALESCE(${matchesSearch}, FALSE) AS "matchesSearch"
    FROM commerce_catalog_items
    WHERE tenant_id = ${tenant.id} AND kind = 'product'
      AND (${matchesSearch} OR id = ${selectedId}::uuid)
    ORDER BY is_active DESC, title
  `;
  const withPhotos = rows.map(({ metadata, ...row }) => ({
    ...row, photoDataUrl: readCatalogueMetadata(metadata).photoDataUrl ?? null,
  }));
  const products: Product[] = withPhotos.filter((item) => item.matchesSearch);
  const selected = withPhotos.find((item) => item.id === selectedId) ?? null;
  const productsPath = tenantPath(tenantSlug, "/app/products");
  const searchParameter = search ? new URLSearchParams({ q: search }).toString() : "";
  const querySuffix = searchParameter ? `&${searchParameter}` : "";
  const closeHref = searchParameter ? `${productsPath}?${searchParameter}` : productsPath;
  const panelOpen = Boolean(selected || createNew === "1");

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="products" />
    <section className="reports-intro"><div><p>CATALOGUE · DATABASE-BACKED</p><h1>Products</h1><span>Retail items that can be added to a sale. Services remain managed separately because they control booking availability.</span></div></section>
    <section className="waybook-data-card">
      <div className="waybook-section-heading"><div><h2>Retail catalogue</h2><p>Products are tenant-scoped and auditable. Gift cards, packages, and memberships will use this same catalogue foundation when their redemption flows are delivered.</p></div><Link className="waybook-primary-link" href={`${productsPath}?new=1${querySuffix}`}>Add product</Link></div>
      <form method="get" className="waybook-list-filter"><label>Search<input key={search} name="q" type="search" defaultValue={search} placeholder="Product name or SKU" /></label><button type="submit">Apply</button></form>
      <div className="waybook-table-wrap"><table><thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Status</th><th>Added</th></tr></thead><tbody>{products.map((item) => <TableRowLink key={item.id} href={`${productsPath}?product=${item.id}${querySuffix}`} label={`Open ${item.title}`}><td><div className="catalogue-row">{item.photoDataUrl ? <img src={item.photoDataUrl} alt="" /> : null}<span><strong>{item.title}</strong><small>{item.description ?? "No description"}</small></span></div></td><td>{item.sku ?? "—"}</td><td>{formatMoney(item.priceCents, item.currency)}</td><td><b className={`sales-status ${item.isActive ? "is-paid" : "is-cancelled"}`}>{item.isActive ? "Active" : "Inactive"}</b></td><td>{new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium" }).format(item.createdAt)}</td></TableRowLink>)}{products.length === 0 ? <tr><td colSpan={5}>{search ? "No matching products. Try a different name or SKU." : "No products yet. Add a product to make it available at checkout."}</td></tr> : null}</tbody></table></div>
    </section>
    {panelOpen ? <div className="tenant-drawer-layer" role="presentation"><Link className="tenant-drawer-scrim" href={closeHref} aria-label="Close product editor" /><ProductEditor key={selected?.id ?? "new"} title={selected ? "Edit product" : "Add product"} closeHref={closeHref}><input type="hidden" name="catalogueQuery" value={search} /><input type="hidden" name="productId" value={selected?.id ?? ""} /><label>Product name<input name="title" defaultValue={selected?.title ?? ""} maxLength={140} required /></label><label>SKU<input name="sku" defaultValue={selected?.sku ?? ""} maxLength={80} placeholder="Optional" /></label><label>Description<textarea name="description" defaultValue={selected?.description ?? ""} maxLength={1000} rows={4} /></label><label>Price<input name="priceDkk" type="number" min="0" max="100000" step="0.01" defaultValue={(selected?.priceCents ?? 0) / 100} required /></label><label>Product photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>{selected?.photoDataUrl ? <><img className="catalogue-photo-preview" src={selected.photoDataUrl} alt="Current product" /><label className="tenant-drawer-check"><input type="checkbox" name="removePhoto" /> Remove photo</label></> : null}<FormToggle name="isActive" label="Available at checkout" defaultChecked={selected?.isActive ?? true} /></ProductEditor></div> : null}
  </main>;
}
