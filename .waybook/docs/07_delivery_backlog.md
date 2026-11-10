# Waybook bounded delivery backlog

## Purpose

This is the finite, decision-oriented backlog for the current Waybook build.
It replaces open-ended feature chasing. A slice is only complete when its
persisted data, authorization, mutation path, focused test, and desktop/mobile
browser check are recorded in its owning document.

## Release boundary

**Pilot-ready is the stopping point for this backlog.** When every P0 and P1
item below is complete, pause feature work and run a launch-readiness review:
security/tenant isolation, recovery, billing/compliance choice, browser QA,
and the first 5–10-client operating workflow. P2 items are deliberately not
silent prerequisites for that decision.

## Approved implementation sequence

This sequence controls feature work. The full priority inventory below remains
the release gate and source of acceptance criteria; it is not execution order.
The operations-only data boundary remains a P0 launch prerequisite and is
handled alongside this sequence, not deferred by it.

| Order | To-do | Why now | State |
| --- | --- | --- | --- |
| 1 | Decoupled resource assignment | Fixes the unsafe resource/calendar coupling without blocking staff slots. | Passed locally 2026-11-08 |
| 2 | Scalable client, staff, and location discovery | Foundation for 50 locations, 500+ staff, and 10k+ clients; unblocks every large-list workflow. | Passed locally 2026-11-08 |
| 3 | Staff-row operational calendar | Depends on scalable staff discovery and keeps the board usable at scale. | Passed locally 2026-11-08 |
| 4 | Shared time-range control | Reuses an existing control and improves location hours, staff shifts, and waitlist windows. | Passed locally 2026-11-08 |
| 5 | Branded online booking and website embed | Turns public booking into a configurable, embeddable product. | Designed |
| 6 | Compact Apps popup | Important usability polish, but no data or booking-risk impact. | Designed |
| 7 | Package redemption at appointment | Completes package value use at checkout. | Passed locally 2026-11-08 |
| 8 | Gift-card tender at appointment | Financially sensitive; follows the same appointment-sale model. | Designed |
| 9 | Appointment-sale detail | Gives managers a complete, safe commerce view. | Designed |
| 10 | Booking operations QA closure | Run continuously during the booking/resource/calendar work, then formally close it. | Partial |
| 11 | Pilot operations readiness | Final release gate: backup/restore, rollback, isolation, rate limits, runbook. | Designed |

Later P2: online-booking add-ons, self-waitlist, client verification, group
bookings, forms, deposits/payments, memberships/wallet, payment-processor
integration, automated provisioning, and SSO.

## Full priority inventory

| Priority | Bounded slice | Definition of done | Owner document | State |
| --- | --- | --- | --- | --- |
| P0 | Harden catalogue media | Decoded JPEG/PNG/WebP type and dimensions are verified before persistence; the shared manager mutation path rejects forged, oversized, corrupt, and extreme-dimension files. A private-S3 policy is designed; data URIs remain bounded until its external provisioning is approved. | `05_commerce_foundation.md` | Passed locally 2026-11-07 |
| P0 | Booking-backed sale read model | One tenant-scoped `commerce_sales.booking_id` record is visible from an appointment and Sales; appointment payment history is read without duplicate financial entries. | `05_commerce_foundation.md` + `03_booking_engine.md` | Passed locally 2026-11-07 |
| P0 | Operations-only data boundary and clinic-first pilot | Set the clinic launch jurisdiction and complete privacy/legal review, data map, processor/subprocessor terms, retention/export/deletion plan, access and audit requirements, incident process, and client-facing notices. The core is for operations only across every vertical: permit contact details, booking/service history, payments, versioned policy acknowledgement, and non-sensitive booking instructions; exclude diagnoses, professional/treatment notes, prescriptions, insurance claims, clinical images, and sensitive health intake. Make patient/client and practitioner/staff terminology tenant-configurable across staff-facing and public booking UI. Verify that notes/forms cannot become a workaround for regulated or sensitive records without a separately approved product and compliance programme. | `00_manifest.md` + `01_architecture.md` + `02_auth_provisioning.md` + `04_modules_ledger.md` | Designed — clinic-first decision recorded 2026-11-08 |
| P1 | Booking product add-ons | Manager can add an active product to an eligible appointment sale; line title/price are snapshots; cancelled/no-show/completed-state rules are explicit; sale and booking audit events are written. | `05_commerce_foundation.md` | Passed locally 2026-11-07 |
| P1 | Package redemption at appointment | Eligible client/service package is selected from the appointment; one entitlement debit and booking-sale record commit atomically; repeat redemption and insufficient balance are rejected. | `05_commerce_foundation.md` + `03_booking_engine.md` | Passed locally 2026-11-08 |
| P1 | Gift-card tender at appointment | Gift-card debit, booking payment representation, and sale transaction commit atomically; balance, card status, currency, client ownership policy, duplicate submission, cancellation, and refund rules are enforced. | `05_commerce_foundation.md` | Designed |
| P1 | Appointment-sale detail | Sales exposes linked appointment, service, add-ons, settlement history, lifecycle/audit metadata, and safe refund/reopen policy without mutating append-only records. | `05_commerce_foundation.md` | Designed |
| P1 | Booking operations QA closure | Execute location-aware create, drag/reschedule, cancellation, terminal status, resource concurrency, and mobile drawer tests for Nordic and Copenhagen; record evidence and any intentional limitations. | `03_booking_engine.md` + `04_modules_ledger.md` | Partial |
| P1 | Scalable client, staff, and location discovery | No operational workflow loads a fixed first 200/250 records or a complete tenant directory into the browser. Shared tenant- and permission-scoped search endpoints provide debounced, cursor-paginated, filterable lists: clients by name/email/phone with a deliberate create-new flow; staff by selected location and optional service eligibility; locations by name. Use these for both selection controls and full directories. Replace capped/unbounded paths in manual booking, calendar controls, packages, gift cards, retail checkout, waitlist, targets, services, Staff, and public location choice. Selected values remain visible; every submitted ID is revalidated server-side. | `03_booking_engine.md` + `04_modules_ledger.md` + `05_commerce_foundation.md` | Passed locally 2026-11-08 |
| P1 | Staff-row operational calendar | Replace the desktop staff-column team Day board with a location-first Day timeline: staff are vertically virtualised/filterable rows; local time runs left-to-right in 30-minute columns; appointment cards span their actual duration. Pin the staff roster and time header; request only the visible staff window and time range; hide off-shift staff by default with an explicit override. Empty cells open the validated appointment flow with staff/date/time prefilled. Horizontal moves change time, vertical moves change staff, and all destinations remain server-authorised and conflict-checked. Preserve an individual Week view; verify desktop and 390px mobile layouts, drag/drop persistence, keyboard access, and large-location performance. | `03_booking_engine.md` + `04_modules_ledger.md` | Passed locally 2026-11-08 — desktop/390px, team-context creation, staff filter, persisted drag, 20-row keyset window/content visibility, and 500-staff fixture evidence |
| P1 | Shared operational time-range control | Extract the accessible 30-minute partial-day time-off range control into a shared component and use it for location opening hours, each recurring staff shift, and the optional waitlist preference window. Preserve multiple staff shifts per day. Migrate location hours from one range per weekday to ordered non-overlapping ranges so locations can represent split hours; validate and persist all ranges atomically. Keep appointment booking/rescheduling as server-computed single-slot selection and calendar drag/drop as direct timeline interaction. | `03_booking_engine.md` + `04_modules_ledger.md` | Passed locally 2026-11-08 — shared keyboard/pointer rail, multi-range location persistence, multi-shift staff editing, and optional waitlist preference verified at desktop and narrow drawer widths |
| P1 | Compact Apps popup | Replace the tall three-column Apps drawer with a search-first, compact menu. Group enabled apps as Operations, Commerce, Setup, and Insights; render one-line icon/name rows in balanced desktop columns, two columns on tablet, and one scrollable column on mobile. Keep role/feature filtering, active state, search, Escape/outside dismissal, focus handling, and working navigation links; do not show unsupported actions or shortcut hints. Verify desktop and 390px mobile height, keyboard traversal, search, dismissal, and route transitions. | `04_modules_ledger.md` | Designed — product decision recorded 2026-11-08 |
| P1 | Decoupled resource assignment | Booking holds and staff-calendar availability reserve staff time only; they neither require nor assign a resource. Replace `booking_blocks.resource_id`-driven allocation with a tenant-scoped resource-assignment lifecycle: managers assign a location- and service-compatible resource after booking, exclusive resources reject overlapping assignments transactionally, and shared resources may overlap. The appointment drawer and Resource Schedule show Assigned/Unassigned state; calendar cards show an assignment badge without blocking staff cells. Moving/cancelling a booking retains, safely releases, or visibly unassigns the resource—never silently clears it. Prevent check-in/completion only if a later service policy explicitly requires assignment. Verify concurrency, reschedule, drag, cancellation, tenant isolation, and non-resource booking regressions. | `03_booking_engine.md` + `04_modules_ledger.md` | Passed locally 2026-11-08 |
| P1 | Branded online booking and website embed | Store tenant public-booking settings for logo, accessible brand colour, introduction/contact copy, policy version/content, locale/currency, and the online service catalogue (category, visibility, description/media, and configurable price display or call-us prompt). Keep pooled **Anyone** practitioner assignment; named-person selection is explicitly out of scope. Add shareable and direct location/service/category links plus a secure external embed: a domain-allowlisted launcher script opens the same Waybook booking flow in an accessible iframe overlay or a normal-link fallback. Configure floating button label/icon/colour/position and optional location/service preset. Enforce `frame-ancestors`, strict origin messaging, source attribution, rate limits, consent audit records, tenant-configured patient/client terminology, and desktop/390px/mobile-host QA. | `03_booking_engine.md` + `04_modules_ledger.md` | Designed — product decision recorded 2026-11-08 |
| P1 | Connected payments — Stripe Connect | Add **Settings → Payments** for an owner to connect or create their own Stripe account through Connect; the tenant business, not Waybook, is merchant of record and receives the funds. Start with direct charges on the tenant’s connected account and Stripe-hosted onboarding/dashboard. Persist only provider account IDs, capability/readiness state, safe payment-method display metadata, and encrypted OAuth credentials where required—never card data or tenant API keys. Create a provider-neutral payment contract before implementation; tie idempotent PaymentIntent, refund, dispute, receipt, and webhook events to immutable booking/commerce ledger entries with reconciliation and audit trails. Then add online deposits/full prepayment, saved-card consent/cancellation charging, and staff checkout to the same lifecycle. Verify onboarding failure/retry/disconnect, duplicate/out-of-order webhooks, failed/partial refunds, booking cancellation, tenant isolation, and one end-to-end test charge/refund per supported country. | `03_booking_engine.md` + `05_commerce_foundation.md` + `02_auth_provisioning.md` | Designed — Stripe selected as first provider 2026-11-08 |
| P1 | Waybook subscription billing — Paddle merchant of record | Keep Waybook plan/subscription money completely separate from tenant-client booking money. Before contracting, choose the selling legal entity, its tax residence, and a company-owned payout account that Paddle accepts; do not connect a founder’s personal Indian bank account or treat a provider balance as a treasury wallet. Obtain jurisdiction-specific accountant/authorised-dealer confirmation for any foreign-currency receipt/holding path. Integrate Paddle for Waybook’s own SaaS plans with hosted checkout, VAT/tax calculation and remittance, invoices/receipts, trials/coupons, upgrades/downgrades, entitlement webhooks, failed-payment recovery, and customer self-service cancellation. Dodo Payments is not a fallback unless it first gives written underwriting acceptance for Waybook as SaaS rather than an unsupported booking/marketplace service. Do not make customer booking payments, tenant funds, or marketplace payouts part of this integration; Stripe Connect remains the separately selected P1 route for tenant booking payments. Verify duplicate/out-of-order entitlement events, plan changes, tax invoices, refunds/chargebacks, and tenant access revocation. | `02_auth_provisioning.md` + `05_commerce_foundation.md` | Designed — Paddle selected first provider; legal entity and payout path required before build 2026-11-08 |
| P1 | Pilot operations readiness | Backup/restore rehearsal, migration rollback plan, tenant-isolation regression coverage, rate-limit review, and production environment runbook complete. | `01_architecture.md` + `06_aws_rds_cutover.md` | Designed |
| P2 | Advanced online-booking conversion | Add service customisations and add-ons, online self-waitlist, existing-client verification/prefill, mobile-service address collection, group/multi-guest bookings, post-booking forms, gift-card/package/membership purchase or redemption, and card/deposit/full-payment rules only after their identity, forms, entitlement, and processor contracts are complete. | `02_auth_provisioning.md` + `04_modules_ledger.md` + `05_commerce_foundation.md` | Designed |
| P2 | Memberships and wallet | Define entitlement/credit lifecycle, expiry, cancellation, reporting, and booking tender contracts before exposing UI. | `05_commerce_foundation.md` | Deferred |
| P2 | Premium clinic EHR add-on | Treat EHR as a separately purchased, explicit clinic add-on—not a hidden expansion of client notes or the shared core. Before implementation, choose launch jurisdictions and complete clinical/legal/privacy review; establish dedicated data classification, tenant isolation, role/least-privilege access, immutable clinical audit trail, consent/legal-basis, retention/export/deletion, incident response, data-residency/subprocessor, interoperability, and break-glass policy. Define only the records actually approved for the module, integrate its appointment references with the core without copying sensitive content back, and ensure clinics without the add-on cannot create or view EHR data. Require jurisdiction-specific functional, security, recovery, and access-audit evidence before sale. | New EHR design document required | Designed — future premium add-on, not a core dependency 2026-11-08 |
| P2 | Marketplace-held booking funds — Mollie Connect | This is a separate opt-in marketplace business model, not an app-owned wallet. Subject to legal/commercial approval and Mollie marketplace onboarding, Waybook becomes payment owner: customer funds sit in Mollie’s regulated holding balance, are reflected by an internal read-model ledger, then route to verified tenant businesses after an explicit policy event (for example completed appointment or a refund-window outcome). Define merchant terms, KYC/KYB, country/currency scope, settlement and payout schedule, commissions, refunds/chargebacks, negative-balance recovery, support ownership, reconciliations, reporting, the maximum hold period, and seller offboarding before implementation. Never treat database wallet credits as withdrawable money or commingle them with Waybook SaaS subscription revenue. | `03_booking_engine.md` + `05_commerce_foundation.md` + `01_architecture.md` | Designed — legal/provider approval required before build 2026-11-08 |
| P2 | Mollie Connect and local-method expansion | Add Mollie Connect only after Stripe’s complete lifecycle is proven, using the same provider-neutral contract and merchant-owned platform model. Evaluate/enable country-specific payment methods per merchant (including MobilePay where the merchant has the required agreement); do not accept provider secrets or weaken the webhook/reconciliation contract. Assess Nexi Checkout/Nets only if a future Nordic merchant requirement cannot be met by the first two providers and its platform/onboarding model is contractually verified. | `05_commerce_foundation.md` | Designed — deferred until primary provider is proven |
| P2 | Automated tenant provisioning and onboarding | Create the business and owner membership; provision its operational database, apply all tenant migrations, seed required defaults, and register its dashboard and booking routes. Add health checks, audit records, monitoring, safe retries and recovery for partial or repeated signups. Verify tenant isolation and the complete signup-to-dashboard flow; measure provisioning time and test concurrent signups. Complete the identity and invitation flows required for self-service. No per-tenant deployment or manual code change. | `02_auth_provisioning.md` | To do — planned for a future self-service onboarding slice |

## Stop rules

1. Do not start a P2 item before all P0/P1 items have a recorded pass or an
   explicit product decision to defer it.
2. Do not add a new module without replacing or explicitly adding it to this
   table with a user-visible decision it supports and bounded acceptance tests.
3. A failed safety, tenancy, financial, or booking-concurrency check blocks
   the current slice; it is fixed before the next row begins.
4. At the pilot-ready gate, decide whether to launch, harden, or expand based
   on verified evidence—not on visual completion.

## Staff-row calendar design checklist

1. Require a selected location and render its local opening-hours range, with
   modest before/after padding rather than a permanent 24-hour canvas.
2. Make the Day timeline the reception default: staff vertically, time
   horizontally, 30-minute start cells, and duration-spanning appointment cards.
3. Provide server-backed staff search and filters (name, active state, service
   eligibility, and on-shift state); do not request every staff row for a large
   location. Hide off-shift staff by default, with a visible Show all control.
4. Virtualise vertical staff rows and load bookings only for the visible roster
   window and selected date/time range. Keep the staff column and time header
   pinned while the grid scrolls.
5. Clicking an empty cell opens the normal appointment flow with location,
   staff, date, and time prefilled. It does not bypass client search, service
   eligibility, resource allocation, or live availability validation.
6. A horizontal drag changes the start time; a vertical drag changes the staff
   member. Render only server-approved drop targets and revalidate the final
   destination transactionally.
7. Preserve the individual Staff Week view for single-person planning. Make
   the staff-row Day timeline usable on desktop and horizontally scrollable on
   mobile without hiding the row identity or time context.
