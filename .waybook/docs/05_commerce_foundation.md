# Commerce foundation

## Status

**Database-backed schema / first vertical slice delivered locally.** Migrations
`0022_commerce_foundation.sql` and the QA corrective
`0023_commerce_ledger_invariants.sql` and
`0024_closed_sale_line_reassignment_guard.sql` and
`0025_commerce_sale_transaction_lifecycle.sql` and
`0026_commerce_sale_refund_cap.sql` and
`0027_gift_card_entry_invariants.sql` and
`0028_gift_card_directional_balance.sql` and
`0029_gift_card_identity_and_hash_version.sql` and
`0030_gift_card_tenant_immutable.sql` and
`0031_package_service_entitlements.sql` and the QA corrective
`0032_package_lifecycle_invariants.sql` and
`0033_appointment_financial_and_lifecycle_invariants.sql`
establish the tenant-local data boundary for the next finance and retention
modules. They are deliberately one cohesive foundation plus one invariant
correction, so the related workflows do not each invent a separate balance,
payment, or entitlement model.

## Included scope

| Capability | Persisted boundary | First product surface |
| --- | --- | --- |
| Product catalogue | `commerce_catalog_items` | Products and checkout lines |
| Appointment and retail sales | `commerce_sales`, `commerce_sale_lines` | Sales queue and checkout drawer |
| Tender/refund ledger | `commerce_sale_transactions` | Sale transaction timeline |
| Client wallet | `commerce_client_wallet_entries` | Client record balance and sale redemption |
| Gift cards | `commerce_gift_cards`, `commerce_gift_card_entries` | Issue, balance, redeem, void |
| Packages | `commerce_packages`, `commerce_package_service_entitlements`, `commerce_entitlement_entries` | Package setup and client visit balance |
| Memberships | `commerce_memberships`, `commerce_entitlement_entries` | Future client enrolment and redemption |
| Saved-payment references | `commerce_payment_method_references` | Processor-backed payment choice only |

All records retain `tenant_id`; every mutation must resolve the tenant and
check owner/manager authority before querying it. Ledger tables are append-only
through the existing database trigger; wallet and gift-card entries also carry
an explicit `credit`/`debit` direction. Balances are calculated from entries,
not copied from booked value or a mutable summary column. Sale lines cannot be
inserted, changed, or removed once their sale is closed or voided. Payments
are accepted once only while a sale is a draft; refunds can be appended only
after it is closed, and are capped at the amount collected.

## Explicit non-scope

This foundation does not claim a live card processor, card storage, invoices,
tax calculation, cash-drawer reconciliation, fiscal receipt delivery,
subscriptions, loyalty campaigns, automated reminders, or external messaging.
Processor references may hold safe opaque IDs and display metadata only—never a
PAN, CVC, or raw card credential. Those workflows need their own provider,
jurisdiction, delivery, and failure-handling contracts after this foundation is
in use.

## Planned: connected payments — Stripe Connect (2026-11-08)

Waybook will expose one tenant-facing **Payments** settings area, not a
generic API-key field. A business owner connects an existing Stripe account or
creates one through Stripe Connect’s hosted onboarding. The connected tenant
business is the merchant of record: charges are created directly on its connected account,
funds settle to its bank account, and it owns its day-to-day refunds and
disputes. Waybook may charge an explicit application fee only after pricing,
merchant agreement, tax, and support ownership are approved.

The first provider contract must work across booking deposits/full prepayment,
saved-card cancellation fees with recorded client consent, appointment
checkout, retail checkout, refunds, receipts, and reconciliation. It requires:

1. tenant-scoped provider connection state (`unconnected`, `pending`,
   `enabled`, `restricted`, `disconnected`) plus safe provider/account IDs and
   capability state; no PAN, CVC, raw API key, or browser-held secret;
2. provider-owned checkout/tokenisation and a Waybook payment attempt/ledger
   reference with idempotency keys, source booking/sale, currency, and
   lifecycle timestamps;
3. signed webhook ingestion with durable event IDs, out-of-order/duplicate
   handling, reconciliation, immutable audit events, and an operator-visible
   exception queue; and
4. explicit refund, cancellation, deposit-capture, receipt, failure, and
   disconnect behaviour before each payment surface is enabled.

Stripe Connect is the first provider because it supports a connected-account
model in Denmark and the Nordic launch area, an OAuth path for an existing
Stripe account, hosted compliance onboarding, direct charges, and a later
in-person terminal option. Mollie Connect is the planned second provider for
European/local-method expansion, including MobilePay where available and
merchant-approved. Do not create a multi-provider checkout or collect
provider API keys before the Stripe lifecycle above has passed end-to-end
tests.

## Planned: two distinct Waybook money products (2026-11-08)

These flows must never share a balance, provider credential, or ledger:

| Flow | Payer and payee | Recommended model | Funds position |
| --- | --- | --- | --- |
| Waybook SaaS subscription | Tenant business pays Waybook | Paddle merchant of record | Waybook revenue only |
| Tenant booking payment | Client/patient pays the tenant business | Stripe Connect direct charge | Tenant-owned funds |
| Marketplace-held booking fund | Client/patient pays Waybook marketplace; Waybook later routes to tenant businesses | Mollie Connect for Marketplaces, only after approval | Mollie-regulated holding balance, not a Waybook wallet |

For Waybook subscriptions, Paddle is the selected merchant-of-record provider
for hosted checkout, recurring billing, tax/VAT, invoices, customer self-service
and payment recovery. Dodo Payments may be evaluated only after it gives
written acceptance for Waybook's specific SaaS subscription business: its
published acceptance policy excludes marketplaces and booking services, so it
must not be used for tenant-client payments or fund routing.

Before enabling subscription billing, Waybook must choose one selling legal
entity, its tax residence, and a payout account owned by that entity. Do not
link a founder's personal bank account or rely on the merchant-of-record
provider's balance as a long-term USD wallet. Where a founder or entity is
resident in India, confirm the permitted foreign-currency receipt, holding and
repatriation path with its accountant and authorised-dealer bank before
selecting a payout account or incorporation structure.

The marketplace model is a later, explicit operating-model change. Waybook
would become payment owner and take first-line responsibility for seller
onboarding, refunds, chargebacks, support, reconciliation and funds-routing
policy. If approved, Mollie holds the funds in its marketplace holding balance
and Waybook maintains only a non-custodial internal read model. The database
must never expose those balances as a withdrawable client/patient or tenant
wallet, and
it must never mix marketplace funds with SaaS subscription revenue.

## Commerce and booking integration audit

**Audited / delivery in progress.** Commerce records are intentionally split
into mutable catalogue definitions, immutable financial commitments, and
booking-facing settlement or entitlement activity:

| Record | Editable surface | Immutable boundary | Booking connection |
| --- | --- | --- | --- |
| Product definition | title, description, SKU, future price, active state, primary photo | closed sale-line title and price snapshot | retail sale may be associated with a booking |
| Gift card | owner, safe internal presentation/visual, note, and explicit lifecycle actions | code, currency, issued balance, and issue/redemption ledger | gift-card tender must append a linked booking payment and card debit atomically |
| Package definition | title, primary photo, future price/service/visit allocation, active state | issued package snapshot and entitlement ledger | active matching package can redeem one visit against an appointment atomically |
| Issued package | explicit status lifecycle only | client, tenant, catalogue, expiry, grant/redeem activity | shows/redeems only on eligible client-service bookings |
| Booking payment | append payment/refund only | individual ledger entries | bridge to booking-backed Commerce sale before retail/add-on tendering |

Products, packages, and gift cards use the same small, database-owned
presentation asset path (JPG/PNG/WebP, 250 KB maximum). A gift-card visual is
presentation-only: it never changes its code, currency, issued balance, or
ledger. The next coherent commerce slice is a booking-backed `commerce_sales`
bridge, which can then connect retail product add-ons, gift-card tender, and
package redemption without duplicating the existing appointment-payment ledger.
Before increasing that small-image scope, move media to a validated object
pipeline with the same decoded-type and dimension checks rather than relying
on browser file metadata.

Appointment-payment and booking-status lifecycle safeguards now precede that
bridge: payment cannot exceed booked value, refund cannot exceed collected
value (including after cancellation), and completed/cancelled/no-show bookings
cannot be reopened.

Migration `0035_package_snapshot_immutability.sql` additionally freezes the
title, price, currency, and service wording captured when a package is issued.

## Delivered: hardened catalogue media

**Database-backed / tested / browser-verified (local Nordic).**
`cataloguePhotoFromForm` is the one manager mutation path for Product, Package,
and Gift-card presentation assets. Before the enclosing transaction writes
metadata, it caps the source file at 250 KB; fully decodes it with the
app-owned `sharp` dependency; permits only JPEG, PNG, or WebP; and rejects
images over 2,400 px on either side or 4 megapixels. Its stored data-URI MIME
type comes from decoded content, never browser-provided metadata. The focused
tests decode valid JPEG/PNG/WebP fixtures and reject a forged MIME/body, an
over-250-KB file, a truncated image, and a 2,401-px image. On 2026-11-07 the
local Nordic Product drawer offered only these three types on desktop and was
overflow-free at 375 px. No file was persisted by that browser smoke check.

Inline data URIs remain the bounded small-asset policy; object storage is not
introduced until its retention, tenant-prefix, signed-read/write, and deletion
policy is decided.

## Media object-storage policy

**Designed / not provisioned.** When catalogue media moves beyond the current
bounded inline policy, Waybook will use one private, environment-specific S3
bucket in `ap-southeast-2`, matching the planned application and database
region. The app runtime—not browsers—will receive least-privilege IAM access.
Objects will be addressed under `tenants/{tenantId}/catalogue/{mediaId}` with
server-generated UUIDs, `Content-Type` from the decoder, SSE-KMS encryption,
and no public ACL or static public URL. The app will issue short-lived,
tenant-authorized reads; upload, replacement, and deletion remain server-side
manager actions. A replacement must write the new object before its database
reference commits and enqueue the old object for deletion only after commit.
S3 lifecycle deletion must never precede the database reference change;
backups follow the environment retention policy.

This policy needs a named AWS account, bucket, KMS key, runtime IAM role, and
environment secrets before it can be provisioned and browser-verified. None
of those external settings has been changed locally.

## Delivered: booking-backed sale read model

**Database-backed / tested / browser-verified (local Nordic).** Migration
`0036_booking_commerce_sales_read_model.sql` backfills and then automatically
creates one `commerce_sales.booking_id` identity for every booking in the same
tenant. Sales now reads those records, while appointment payment and refund
history continues to read only `payment_records`; no `commerce_sale_transactions`
are created by the bridge. The manager Booking table links an appointment to
its sale without exposing the sales surface to non-managers. On 2026-11-07 the
local verifier found 68 linked Nordic sales and 1 Copenhagen sale, with no
orphaned links or copied payment entries. Nordic Sales and Booking links were
browser-verified on desktop and at a 375 px viewport without horizontal
overflow.

## Delivered: booking product add-ons

**Database-backed / tested / browser-verified (local Nordic).** Managers can
add an active catalogue product and quantity to an open appointment sale only
while its booking is `confirmed` or `arrived`. Migration
`0037_booking_product_addon_lifecycle.sql` enforces that rule in PostgreSQL,
so completed, cancelled, and no-show appointments reject direct inserts as
well as UI requests. Every line stores the product title and unit price at the
time it is added; the manager action writes both a booking event and a tenant
audit event in the same transaction. The local rollback-only verifier proved
the immutable snapshot and terminal-state rejection on 2026-11-07. The Nordic
Sales drawer exposed the active-product picker on desktop and at 375 px without
overflow. Add-ons remain untendered until the following package/gift-card and
appointment settlement slices define one atomic payment path; the established
appointment payment ledger is deliberately not widened here.

## Delivery order

The authoritative priority and pilot stop gate are in
[Delivery backlog](07_delivery_backlog.md). This order describes dependency,
not an unlimited commitment to keep adding commerce features.

1. Build a booking-backed sale read model without duplicating or mutating the
   existing immutable appointment ledger.
2. Product add-ons and package redemption are delivered locally. Package
   redemption debits one matching active client visit only for a confirmed or
   arrived, otherwise-unpaid appointment; terminal appointments, duplicate
   redemption, and mixed payment tender are rejected. Gift-card tender remains
   the next bounded atomic appointment-sale flow.
3. Complete appointment-sale detail and focused booking-commerce QA.
4. Defer wallet, memberships, processor integration, and other P2 work until
   the pilot-release gate is reviewed.

Each step reuses this schema rather than adding new finance tables. A later
migration is warranted only if a discovered provider or legal requirement
changes an invariant, not merely to expose another screen.

## Delivered: product catalogue and manual retail checkout

**Database-backed / build-verified / browser-verified (local Nordic).** Apps
now exposes a manager-only Products workspace. It is tenant-scoped end to end,
supports add, edit, search, SKU normalization and reversible deactivation, and
writes an audit event for each mutation. Products are not deleted, so historic
sale lines retain their immutable item snapshot.

Sales now exposes a manager-only retail checkout. A user selects a tenant
client and active product to create a draft, can add further products, then
records one exact manual tender (card, cash, bank transfer, or other) to close
the checkout atomically. The server calculates the tender from the immutable
sale lines; it never accepts a client-supplied amount. Closing writes the
payment transaction, sale status, and audit event together. Closed lines and
payments cannot be edited; a future refund is an append-only ledger entry.
This is a manual-recording workflow, not a card-processor integration.

## Delivered: gift-card register

**Database-backed / build-verified.** Managers can issue a client-linked or
unlinked card from Apps → Gift cards, using a number that is HMAC-hashed before
storage and represented only by its final four characters thereafter. Initial
value is a single append-only issue entry and the displayed balance is always
derived from entries. Database guards lock the card during an entry, enforce
tenant ownership and active status, prevent duplicate issue, and reserve
redemption/refund operations for their future checkout workflow. Production
issuance requires `WAYBOOK_GIFT_CARD_CODE_SECRET`; local development uses an
explicit development-only fallback and never accepts it in production.

## Delivered: package setup and client package register

**Database-backed / build-verified.** Managers can define a priced package for
one selected active service, with a fixed number of visits and optional expiry,
then issue it to a selected client from Apps → Packages. Issuance appends an
immutable, configured credit grant for the package service. Database guards
lock the package, validate tenant and service ownership, reject a duplicate
initial grant, enforce grant/credit and redemption/debit direction, prevent
post-expiry use, freeze the issued package's client/catalogue/tenant/expiry
identity, and reject redemption beyond the derived balance. Package
redemption is intentionally not yet exposed: it must be recorded atomically
with appointment checkout rather than as a standalone counter decrement.
