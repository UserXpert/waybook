import { ListFilterOptions } from "@/components/workspace-options";
import { TableDateFields } from "@/components/table-date-fields";
import { hasTableDateFilters, dateFilterParams, dateRangeWhere, tableDateFilters, tableDateOrder, type TableDateParams } from "@/lib/waybook/table-date-filters";
import { notFound } from "next/navigation";
import { TenantEditorClose, TenantEditorDialog } from "@/components/tenant-editor-dialog";
import Link from "next/link";
import { TableRowLink } from "@/components/table-row-link";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requirePageFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { getTenantTerminology } from "@/lib/waybook/tenant-terminology";
import { titleTerminology } from "@/lib/waybook/terminology-labels";
import { GiftCardIssueDrawer } from "@/components/gift-card-issue-drawer";
import { updateGiftCardDetails } from "./actions";
import { ClientPicker } from "@/components/client-picker";

type GiftCard = { id: string; codeLastFour: string; status: string; currency: string; ownerId: string | null; ownerName: string | null; balanceCents: number; createdAt: Date; entryCount: number; photoDataUrl: string | null };
const entryLabels = { issue: "Issued", redeem: "Redeemed", refund: "Refunded", adjustment: "Adjusted", void: "Voided" };
type GiftCardEntry = { id: string; kind: keyof typeof entryLabels; direction: "credit" | "debit"; amountCents: number; createdAt: Date };
const money = (cents: number, currency: string) => new Intl.NumberFormat("en-DK", {
  style: "currency", currency, minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
}).format(cents / 100);
const pageSize = 150;
const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export default async function GiftCardsPage({ searchParams }: { searchParams: Promise<{ card?: string; new?: string; q?: string; edit?: string; page?: string } & TableDateParams> }) {
  const { card, new: createNew, q, edit, page: rawPage, sort, from, to } = await searchParams;
  const selectedId = typeof card === "string" && uuidPattern.test(card) ? card : null;
  const requestedPage = typeof rawPage === "string" && /^[1-9]\d{0,8}$/.test(rawPage) ? Number(rawPage) : 1;
  const { tenant, membership } = await requireTenantWorkspace();
  await requirePageFeature(tenant.id, "booking-essentials");
  if (!(await staffPermissionContext(tenant, membership)).isManager) notFound();
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  const search = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const terminology = await getTenantTerminology(tenant);
  const clientLabel = titleTerminology(terminology.client);
  const db = tenantDb(tenant);
  const dates = tableDateFilters({ sort, from, to }, tenant.timezone);
  const dateRange = dateRangeWhere(db, "gc.created_at", dates);
  const dateOrder = tableDateOrder(db, "gc.created_at", "gc.id", dates);
  const cardScope = db`
    FROM commerce_gift_cards gc
    LEFT JOIN customers c ON c.id=gc.issued_to_customer_id AND c.tenant_id=gc.tenant_id
    WHERE gc.tenant_id=${tenant.id}
  `;
  const cardSummary = db`
    SELECT gc.id,gc.code_last_four AS "codeLastFour",gc.status,gc.currency,gc.issued_to_customer_id AS "ownerId",
      c.name AS "ownerName",gc.metadata->>'photoDataUrl' AS "photoDataUrl",gc.created_at AS "createdAt",
      ledger."entryCount",ledger."balanceCents"
    FROM commerce_gift_cards gc
    LEFT JOIN customers c ON c.id=gc.issued_to_customer_id AND c.tenant_id=gc.tenant_id
    CROSS JOIN LATERAL (
      SELECT count(*)::int AS "entryCount",
        coalesce(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::int AS "balanceCents"
      FROM commerce_gift_card_entries WHERE tenant_id=gc.tenant_id AND gift_card_id=gc.id
    ) ledger
    WHERE gc.tenant_id=${tenant.id}
  `;
  const pattern = `%${search}%`;
  const searchFilter = search ? db`AND (gc.code_last_four ILIKE ${pattern} OR c.name ILIKE ${pattern})` : db``;
  const [[total], [selected]] = await Promise.all([
    db<{ count: number }[]>`SELECT count(*)::int AS count ${cardScope} ${searchFilter} ${dateRange}`,
    selectedId ? db<GiftCard[]>`${cardSummary} AND gc.id=${selectedId}` : [],
  ]);
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total.count / pageSize)));
  const offset = (page - 1) * pageSize;
  const [cards, entries] = await Promise.all([
    db<GiftCard[]>`${cardSummary} ${searchFilter} ${dateRange} ORDER BY ${dateOrder} LIMIT ${pageSize} OFFSET ${offset}`,
    selected ? db<GiftCardEntry[]>`SELECT id,kind,direction,amount_cents AS "amountCents",created_at AS "createdAt" FROM commerce_gift_card_entries WHERE tenant_id=${tenant.id} AND gift_card_id=${selected.id} ORDER BY created_at DESC,id DESC` : [],
  ]);
  const path = tenantPath(tenantSlug, "/app/gift-cards");
  const registerHref = (pageNumber: number, cardId?: string) => {
    const params = dateFilterParams(new URLSearchParams(), dates);
    if (cardId) params.set("card", cardId);
    if (search) params.set("q", search);
    if (pageNumber > 1) params.set("page", String(pageNumber));
    return params.size ? `${path}?${params}` : path;
  };
  const closeHref = registerHref(page);
  const listHref = (item: GiftCard) => registerHref(page, item.id);
  const editing = Boolean(selected && edit === "1");

  return <main className="waybook-data-page tenant-dashboard-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={tenantSlug} tenantName={tenant.name} active="giftCards" />
    <section className="reports-intro"><div><p>{clientLabel.toUpperCase()} VALUE · DATABASE-BACKED</p><h1>Gift cards</h1><span>Issue cards, link them to a {terminology.client}, and track their remaining balance without storing the full number.</span></div></section>
    <section className="waybook-data-card"><div className="waybook-section-heading workspace-filter-bar"><div><h2>Gift-card register</h2><p>Balances are derived from immutable entries. Use a card for an eligible appointment from Sales.</p></div><Link className="waybook-primary-link" href={`${path}?new=1`}>Add gift card</Link><ListFilterOptions label="Gift-card register" active={Boolean(search) || hasTableDateFilters(dates)} clearHref={path}><label>Search<input name="q" type="search" defaultValue={search} placeholder={`Card suffix or ${terminology.client}`} /></label><TableDateFields dates={dates} label="Issued date range" /></ListFilterOptions></div><div className="waybook-table-wrap"><table><thead><tr><th>Number</th><th>Balance</th><th>Owner {terminology.client}</th><th>Status</th><th>Issued</th></tr></thead><tbody>{cards.map((item) => <TableRowLink key={item.id} href={listHref(item)} label={`Open gift card ending ${item.codeLastFour}`} className={selected?.id === item.id ? "is-selected" : undefined}><td><div className="catalogue-row">{item.photoDataUrl ? <img src={item.photoDataUrl} alt="" /> : null}<span><strong>•••• {item.codeLastFour}</strong><small>{item.entryCount} ledger {item.entryCount === 1 ? "entry" : "entries"}</small></span></div></td><td>{money(item.balanceCents, item.currency)}</td><td>{item.ownerName ?? "Not linked"}</td><td><b className={`sales-status ${item.status === "active" ? "is-paid" : "is-cancelled"}`}>{item.status}</b></td><td>{new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium" }).format(item.createdAt)}</td></TableRowLink>)}{cards.length === 0 ? <tr><td colSpan={5}>{search ? "No gift cards match this search." : `No gift cards yet. Add one to start tracking ${terminology.client}-held value.`}</td></tr> : null}</tbody></table></div>
      {total.count > pageSize ? <nav className="waybook-list-filter sales-pagination" aria-label="Gift-card register pages">
        <span>Showing {offset + 1}–{Math.min(offset + pageSize, total.count)} of {total.count}</span>
        {page > 1 ? <Link href={registerHref(page - 1)}>Previous page</Link> : null}
        {offset + pageSize < total.count ? <Link href={registerHref(page + 1)}>Next page</Link> : null}
      </nav> : null}
    </section>
    {selected ? <TenantEditorDialog key={editing ? `edit-${selected.id}` : selected.id} title="Gift-card details" closeHref={closeHref} cycleFocus dismissSuccessToastOnClose><aside className="tenant-drawer appointment-drawer" aria-label="Gift-card details"><header><div><p>GIFT CARDS</p><h2>Card ending {selected.codeLastFour}</h2><span>Card identity, balance, and ledger entries stay protected.</span></div><TenantEditorClose href={closeHref} label="Close gift-card panel">Close</TenantEditorClose></header>
      {selected && editing ? <form action={updateGiftCardDetails} className="tenant-drawer-form"><input type="hidden" name="cardId" value={selected.id} />{search ? <input type="hidden" name="q" value={search} /> : null}{page > 1 ? <input type="hidden" name="page" value={page} /> : null}<ClientPicker name="ownerId" terminology={terminology} label={`Owner ${terminology.client}`} initial={selected.ownerId && selected.ownerName ? { id: selected.ownerId, name: selected.ownerName, email: "", phone: null } : null} /><label>Card visual<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /></label>{selected.photoDataUrl ? <><img className="catalogue-photo-preview" src={selected.photoDataUrl} alt="Current gift-card visual" /><label className="tenant-drawer-check"><input type="checkbox" name="removePhoto" /> Remove visual</label></> : null}<button type="submit">Save details</button><Link className="waybook-secondary-link" href={listHref(selected)}>Cancel</Link></form> : null}
      {selected && !editing ? <div className="appointment-drawer__body"><section className="client-record__overview"><div><span>Balance</span><strong>{money(selected.balanceCents, selected.currency)}</strong></div><div><span>Owner</span><strong>{selected.ownerName ?? "Not linked"}</strong></div><div><span>Status</span><strong>{selected.status}</strong></div></section><Link className="waybook-secondary-link" href={`${listHref(selected)}&edit=1`}>Edit owner and presentation</Link><section><h3>Activity</h3><ul className="client-record__ledger">{entries.map((entry) => <li key={entry.id}><div><strong>{entryLabels[entry.kind]}</strong><span>{new Intl.DateTimeFormat("en-GB", { timeZone: tenant.timezone, dateStyle: "medium", timeStyle: "short" }).format(entry.createdAt)}</span></div><b className={entry.direction === "debit" ? "is-refund" : undefined}>{entry.direction === "debit" ? "−" : "+"}{money(entry.amountCents, selected.currency)}</b></li>)}</ul></section></div> : null}
    </aside></TenantEditorDialog> : createNew === "1" ? <GiftCardIssueDrawer closeHref={closeHref}><label>Gift-card number<input name="code" maxLength={40} pattern={"[A-Za-z0-9\\-]{8,40}"} placeholder="e.g. WBOOK-2026-AB12" required /></label><label>Initial balance (DKK)<input name="amountDkk" type="number" min="1" max="100000" step="1" required /></label><ClientPicker name="ownerId" terminology={terminology} label={`Owner ${terminology.client}`} /></GiftCardIssueDrawer> : null}
  </main>;
}
