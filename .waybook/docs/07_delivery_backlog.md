# Waybook bounded delivery backlog

## Purpose

This is the finite, decision-oriented backlog for the current Waybook build.
It replaces open-ended feature chasing. A slice is only complete when its
persisted data, authorization, mutation path, focused test, and desktop/mobile
browser check are recorded in its owning document.

## Current priority — workspace performance and scale (2026-11-10)

On 2026-11-18, a signed-in owner navigated in Chrome against the local
Next.js development server. One automation-timed sample took approximately
1,272 ms from clicking Clients to its heading appearing; another took 1,011 ms
from clicking Calendar to its route changing. These measurements include
browser automation and development-mode overhead, use different completion
signals, and are not production, sustained-load, or before/after benchmarks.
The client directory and calendar rendered. Further repeatable measurements of
hosted behavior and calendar readiness are needed before drawing conclusions.


Before continuing feature work, measure and improve page navigation and database
latency, then test representative multi-year tenant workloads. Local development
currently uses remote Control and tenant databases: a read-only probe measured
about 225–309 ms per warm round trip and 2.2–2.9 seconds for a new connection.
This is not a production benchmark. Reuse request-scoped identity, tenant and
permission checks; remove independent query waterfalls; profile the overdue
booking sweep and move it off interactive requests only after its scheduled
execution and recovery are proven; inspect history-dependent queries and index
plans with realistic data. Preserve tenant isolation and lifecycle correctness.
Record before/after timings, test results and any remaining operational limits.
Completed items remain in the historical inventory below, not the active queue.

First local slice: reuse identity, tenant and permission resolution within a
single React server render, while keeping explicit API-header resolution separate;
load the three independent online-booking settings queries concurrently. A
three-sample, read-only warm-pool probe against the configured tenant database
measured those queries at 1,435–2,407 ms sequentially and 544–803 ms in parallel.
This is query-level evidence, not an end-to-end or multi-year workload benchmark.
The overdue sweep remains on requests until the scheduler is proven reliable.

An isolated local database with 3,000 synthetic clients and 30,000 bookings
spread over roughly three years exposed two history-dependent scans. On that
fixture, paging clients before aggregating their bookings reduced one warm
`EXPLAIN ANALYZE` sample from 8.699 ms to 1.107 ms; the first page, a later
cursor page and a filtered page matched the previous results. Migration 0049
adds a partial index for confirmed bookings: the empty overdue lookup fell from
1.303 ms and 753 buffer hits to 0.021 ms and 2 buffer hits in one warm sample.
The actual sweep converted one synthetic confirmed booking once and left
arrived and completed bookings unchanged. These are local query timings, not
end-to-end latency or a concurrency benchmark. Migration 0049 has been applied
only to the disposable benchmark database; plan production index creation and
locking before deploying it to a large tenant. The disposable database was
removed after verification.

A repeat run on 2026-11-18 used local PostgreSQL temporary tables with
3,000 synthetic clients and 30,000 bookings. Client first/later pages, search,
selector and foreign cursor matched: one warm query sample was 6.603 ms before
and 0.513 ms after. The booking query matched manager, staff, filters and search
cases; three samples were 61.3–63.8 ms before and 2.5–3.6 ms after. These are
query-level local measurements, not hosted or end-to-end performance evidence.

The client lookup API also serves directory pagination and operational
selectors, so it now pages clients before aggregating booking history. Against
temporary local tables with 3,000 synthetic clients and 30,000 bookings, a
warm query sample fell from 7.051 ms to 0.553 ms. Results matched the previous
query for first and later pages, search, small selector pages, duplicate names,
and a cursor from a second synthetic tenant. A signed-in browser check returned
two non-overlapping pages from the existing API. These are query-level checks;
they do not establish end-to-end or production concurrency performance.
The repeatable local-only verifier is `scripts/verify-waybook-client-pagination.ts`;
set `WAYBOOK_LOCAL_PERF_DB_URL` to a local PostgreSQL database and run it with
`node --import tsx`. It creates only temporary tables and rejects remote hosts.
The bookings list now selects the latest 100 matching bookings before joining
payment history. `scripts/verify-waybook-bookings-performance.ts` compares the
old and new queries using 30,000 synthetic bookings in local temporary tables,
including access filters, searches, refunds and tenant boundaries. Three warm
local runs measured about 60 ms before and 1–2 ms after for the query alone;
these are not end-to-end or production timings. Tied start times now use the
booking ID as a deterministic secondary sort. The local mobile bookings table
still needs a separate readability review.

The shared navigation now loads feature settings and the permission-gated
review indicator concurrently instead of waiting for the feature query first.
The manager's app drawer and Services navigation were checked locally on desktop,
and the drawer was opened at mobile width. No end-to-end timing comparison or
staff-role browser verification has yet been recorded for this change.

Migration 0050 adds a partial index for ended-arrival review lookups. With
100,000 synthetic bookings in a temporary local table, one `EXPLAIN ANALYZE`
sample for the navigation's existence check fell from 0.532 ms (148 local
buffer hits) to 0.009 ms (two local buffers); the ordered booking lookup fell
from 2.615 ms to 0.004 ms. This measures the lookup, not the notification
page's joins or end-to-end latency. The migration has not been applied to a
hosted database; assess index creation locking before deploying it.

Workspace lookup now retrieves the active tenant and the signed-in identity's
membership in one Control database query. An isolated database check exercised
valid memberships, cross-tenant denial, inactive tenants and invalid slugs;
the owner navigated to Bookings locally on desktop and mobile. The active-staff
check and overdue sweep remain in place. The local overdue cron runs only daily,
so removing the request-time sweep would leave statuses stale. No end-to-end
before/after timing or staff-role browser check has yet been recorded.
Repeat the isolated access checks with
`scripts/verify-waybook-workspace-lookup.ts` and a local
`WAYBOOK_LOCAL_PERF_DB_URL`; it creates temporary tables only and checks
membership removal as well as tenant and lifecycle boundaries.

The calendar's default-location lookup now uses timezone-aware day boundaries
instead of applying `to_char` to each booking. On 100,000 synthetic bookings,
a local count-query sample fell from 24.252 ms to 0.015 ms and used the existing
tenant/start index. Day counts matched for manager and staff filters across
Copenhagen, New York and Kolkata, including DST transition dates. This is not
an end-to-end timing, and multi-location selection still needs browser coverage.
The owner calendar and next-day navigation were checked locally, including a
mobile viewport.

Availability now batches rules, overrides and occupied blocks per service
instead of issuing three serial queries per eligible staff member. An isolated
comparison of the actual old and new calculators matched slots for two staff,
an override, another tenant's records, an occupied block and a reschedule
exclusion. The owner calendar showed bookable and occupied slots locally on
desktop and mobile; 36 Waybook tests and a production build passed. Larger
end-to-end workloads and concurrent holds still require verification.
Occupied-block reads now also exclude history outside a conservative two-day
margin around the requested range. An isolated comparison with 1,000 historical
blocks and a boundary-crossing held block matched the earlier slot results;
desktop and mobile calendar rendering and the production build passed. This
does not replace concurrency or production-scale end-to-end testing.
Extra-hours overrides could previously generate slots outside the requested
range. Availability now bounds override reads and excludes those slots, so the
occupied-block range limit cannot expose an unchecked outside slot. An isolated
regression reproduced the old leakage and verified in-range parity with held
and excluded blocks; the public time selector loaded locally on desktop and
mobile and the production build passed.
Availability's independent location/service lookups and subsequent
hours/closure/member/hold-expiry operations now run concurrently; expired holds
still finish updating before occupied blocks are read. The isolated slot parity
and out-of-range override checks passed, as did the public time-selector check
on desktop and mobile. No remote before/after timing has yet been recorded.
Closure-date reads also include the surrounding local dates. A synthetic
UTC+14 test reproduced and corrected a case where extra hours on a closed local
day appeared bookable because both UTC query endpoints fell on the prior day.
The public time selector and production build passed locally after the fix.
Run `scripts/verify-waybook-availability.mts` with a local
`WAYBOOK_LOCAL_PERF_DB_URL` on Node 26 to repeat the actual availability-code
checks for occupied and excluded blocks, tenant separation, requested range,
and a UTC+14 closure with an open-day control. It uses temporary tables only.

An isolated production-mode HTTP check used fully migrated local databases
with 30,050 bookings, 3,015 clients, 11 services, 11 staff and four locations.
After one initial request, three warm full-response samples were 13–19 ms for
the overview, 26–32 ms for bookings, 7–8 ms for clients and 84–91 ms for the
calendar. Four concurrent calendar responses took 158–304 ms each. These are
local server HTTP timings with synthetic data, not browser rendering, a remote
database, hosted production or a sustained-load test. The existing local dev
server points at remote databases; its previously observed round-trip latency
therefore remains relevant. The fixture used completed historical bookings and
does not establish correctness under simultaneous booking mutations.

An isolated production-mode public-hold race used one eligible staff member
and eight simultaneous requests per slot against the 30,050-booking fixture.
The first run returned one 201 and seven generic 422 responses. A synchronized
reproduction identified PostgreSQL deadlock errors (40P01). The transaction
retry wrapper now retries deadlocks with the same bounded backoff as serialization
failures. Four synchronized races and one normal race on the final build each
returned one 201 and seven 409 conflicts, with exactly one active hold; 11
retry-wrapper tests passed. The temporary delay and diagnostic logs were removed.
These local results do not replace hosted or sustained concurrency testing.
After availability-query parallelization, the isolated race again produced one
201 and seven generic 422 responses. PostgreSQL logs from that run show repeated
deadlocks between inserts checking the staff overlap exclusion constraint.
Public hold transactions now take a tenant-and-staff-scoped transaction lock
before inserting, while the exclusion constraint continues to guard other
writers. On the revised production build, two eight-request races with a test
trigger delaying inserts each produced one 201, seven 409 responses and one
active hold; one run included expired-hold cleanup. The trigger was removed.
This is local evidence for competing holds, not proof of hosted behavior or
all combinations of concurrent rescheduling and calendar mutations.
The current Waybook retry call sites wrap database transactions; email delivery
prompts in calendar actions occur after the transaction completes. This source
review does not establish behavior for future call sites or external consumers.

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
| 6 | Compact Apps popup | Important usability polish, but no data or booking-risk impact. | Implemented locally; desktop/390px layout, search, Escape, outside dismissal and navigation verified 2026-11-18; keyboard focus wrapping also verified; role-specific visibility still requires checks |
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
