# Waybook Phase 1 — Living MVP Brief

> **Read this file before starting or resuming Waybook implementation.**
> Update the status ledger and the relevant acceptance criteria after every meaningful implementation or verification step. Do not call a visual screen a working feature unless the associated data, authorization, mutations, and tests are complete.

## Product outcome

Waybook Phase 1 is a real multi-tenant booking SaaS. It is not a Booking Kit demo, a marketing page, or a static dashboard.

It contains three isolated operating spaces:

1. **Waybook Control** — the platform-operator workspace.
2. **Nordic Studio** — a tenant workspace and public booking site.
3. **Copenhagen Physio** — a separate tenant workspace and public booking site.

The product must use a hybrid architecture:

- One PostgreSQL **Control database** for identities, platform administrators, tenant registry/lifecycle, domains, memberships, plans, connection references, provisioning/migration/backup status, feature flags, and immutable platform audit events.
- One PostgreSQL **operational database per tenant** for staff, services, availability, resources, customers, holds, bookings, booking events, tenant audit events, and future payment records.
- Every operational record still includes immutable `tenant_id` as defence in depth.

Initial local database topology:

```text
waybook_control
waybook_nordic_studio
waybook_copenhagen_physio
```

No real client database, payment account, OAuth credential, or production environment may be connected during this phase.

## Working-product standard

Every update must label the result truthfully as one of:

- **Designed** — documented only; no executable implementation.
- **Mock** — rendered against hard-coded/in-memory data.
- **Database-backed** — reads and writes persisted local data.
- **Tested** — automated test coverage passed for the stated behaviour.
- **Browser-verified** — verified in desktop and mobile browser flows.

Never call a visual shell, seed-only prototype, or static dashboard a functioning product.

## Efficient delivery and verification rules

These rules protect product quality while avoiding unnecessary Codex usage. They do **not** reduce the required proof for real behaviour.

1. Batch related visual changes, then inspect the complete result once in the browser. Do not restart or production-build after each spacing, colour, or layout adjustment.
2. For visual-only changes, use lightweight checks such as type/lint scope appropriate to the files changed and browser inspection. Run a clean production build only when a functional boundary, server code, data contract, or integration changes.
3. For a functional feature, complete the vertical slice before verification: persisted data → server authorization → mutation/read path → focused automated test where applicable → desktop/mobile browser flow. Build and test once per completed feature milestone, not per partial edit.
4. Reserve deeper reasoning, database inspection, concurrency checks, and full builds for genuine product behaviour, security, tenancy, or migration risk.
5. At major milestones, use this file as the compact handoff into a fresh focused chat. A fresh chat does not reset usage limits, but prevents repeatedly carrying a large working conversation through small edits.
6. Every progress report must name the evidence level: **Designed**, **Mock**, **Database-backed**, **Tested**, and/or **Browser-verified**. State unverified work explicitly.
7. If two attempts at the same problem fail, stop and reassess from evidence rather than spending further usage on speculative retries.

## Package decision

Use these as Waybook foundations and adapt their source where Waybook requires stronger tenancy/security:

- `@thebookingkit/core`
- `@thebookingkit/server`
- `@thebookingkit/db`

Do not use:

- `@thebookingkit/d1` — Waybook uses PostgreSQL, not Cloudflare D1/SQLite.
- `@thebookingkit/cli` — build a Waybook CLI later for Waybook provisioning, tenant migrations, and operational checks.

### Approved reuse

- **Core:** availability/slot calculation, RRULE handling, timezone utilities, buffers, team scheduling, resource scheduling, booking limits, and input validation.
- **Server:** serializable-transaction retry, conflict translation, date/ICS helpers, adapter interfaces, and selected cryptographic utility patterns.
- **DB:** Drizzle + `postgres.js`, PostgreSQL exclusion-constraint patterns, append-only audit design, and useful test cases.

### Must be replaced or redesigned

- Booking Kit’s optional organization scoping, generic roles, and generic auth helpers.
- Booking Kit database schema and migrations as the Waybook schema.
- Signed booking-management token format; Waybook uses opaque, hashed, scoped, revocable token records.
- In-memory rate-limit calculations; Waybook uses shared durable rate-limit storage.
- Demo/barber data, marketing content, package promotion, D1, payments, queues, kiosk, recurring bookings, routing forms, embeds, webhooks, workflows, calendar sync, and SMS for Phase 1.

## Required product behaviour

### Authentication and authorization

- Database-backed identities and secure sessions.
- Roles: `platform-admin`, `owner`, `manager`, `staff`, `read-only`.
- Platform roles are separate from tenant roles.
- Every server mutation and data read checks identity, membership, role, and tenant context.
- No support impersonation in Phase 1.

### Tenant routing and isolation

- Resolve tenant only on the server: `hostname/session -> Control tenant registry -> approved database connection`.
- Local public hosts use `nordic.localhost:PORT` and `copenhagen.localhost:PORT`.
- The browser never supplies a database identifier, connection string, or route target.
- Nordic Studio can never read or mutate Copenhagen Physio records, and vice versa.

### Platform dashboard — Waybook Control

- Tenant list and detail.
- Tenant health, plan, connection/provisioning state, migration version, backup status.
- Basic booking volume and active-user health.
- Create, suspend, and reactivate tenant.
- Provision a tenant database.
- Immutable platform audit trail.

### Feature modules and tenant entitlements

Waybook has one shared product codebase. The Control plane decides which actual modules a tenant may use; modules are never separate dashboard builds.

- **Booking essentials** is the baseline module: services, eligible staff, availability, public booking, holds, and confirmations.
- Independently controlled modules are: **Clients**, **Team**, **Calendars**, **Resources**, and **Email notifications**.
- Future modules (payments, external calendar sync, SMS, embeds, webhooks, workflows) remain out of Phase 1 and must be separately enabled when introduced.
- The Control database stores per-tenant feature states and plan defaults. The future provisioning workflow must apply the correct defaults to every new tenant automatically.
- Only a platform administrator can change feature state. Every change writes an immutable Control audit event.
- Feature checks run server-side on every page, read, mutation, and public endpoint that belongs to a module. Hiding a dashboard link is never authorization.
- Disabling a module hides access and rejects its operations but does not delete tenant data. Re-enabling restores access to that same data.

### Tenant provisioning model

Waybook has one tenant-dashboard codebase, not one separately built dashboard per customer. When a new client signs up, a Control-plane provisioning workflow must automatically:

1. Create the tenant registry record and owner membership.
2. Create a dedicated operational PostgreSQL database.
3. Run tenant migrations and record their version/status.
4. Seed required tenant settings and the initial owner workspace.
5. Register an approved database connection reference and tenant domain/subdomain.
6. Verify the database is healthy, write platform audit events, and mark the tenant active.

No manual code change, dashboard build, or deployment should be required for a newly provisioned tenant. Nordic Studio and Copenhagen Physio are currently manually provisioned local seed tenants; automate this workflow before claiming self-service onboarding works.

### Tenant dashboards — Nordic Studio and Copenhagen Physio

- Today/upcoming bookings, booking list, and calendar.
- Services, staff, rooms/resources.
- Working hours, breaks, holidays, blackout dates, and buffers.
- Customers.
- Public booking-page settings.
- Team role management.
- Default timezone: `Europe/Copenhagen`.

### Public booking flow

```text
Service -> staff/resource -> date/time -> hold -> customer details -> confirmation
```

- Store timestamps in UTC; render in tenant timezone.
- Holds have an expiry and occupy availability until expiry/release/confirmation.
- PostgreSQL transaction and constraints prevent conflicting bookings.
- Confirmation/cancellation email enters a safe local test outbox before any external provider is introduced.
- Customer-management links are opaque, short-lived, tenant/booking/action scoped, hash-stored, and revocable.

## Database invariants

- Database constraints, not UI checks, are authoritative for double-booking prevention.
- Provider/resource conflicts include effective booking buffers.
- Booking confirmation from a hold is transactional and idempotent.
- Audit records are append-only and include actor, tenant, target, action, request/correlation ID, timestamp, and structured metadata.
- All local migrations are versioned, idempotent where appropriate, recorded in the Control database, and executed separately against each tenant database.

## Implementation order and proof

| Step | Deliverable | Required proof |
| --- | --- | --- |
| 1 | Remove mock data boundary and establish local PostgreSQL topology | Databases reachable; no production credential present |
| 2 | Control schema and migrations | Fresh migration test; seed platform admin and two tenant registry records |
| 3 | Tenant schema and migrations | Fresh migration test for Nordic and Copenhagen; immutable tenant IDs present |
| 4 | Session/auth/membership and server tenant resolver | Authorization and cross-tenant-denial tests pass |
| 5 | Booking domain: availability, holds, confirmation, audits, local outbox, customer links | DST, expiry, token, audit, and concurrency tests pass |
| 6 | Database-backed Control dashboard | Browser verifies real tenant stats and lifecycle state |
| 7 | Feature entitlements and Control gate | Platform-only toggle writes an audit event; server-side denial tests pass for disabled modules |
| 8 | Database-backed Nordic and Copenhagen dashboards | Browser verifies separate records and permitted mutations behind enabled modules |
| 9 | Public booking site per tenant | Desktop/mobile booking, hold, confirmation, and management link verified |
| 10 | Operational hardening | Rate-limit, migration, backup/recovery, and environment checks verified |

## Required automated tests

- Tenant isolation: tenant A cannot query or mutate tenant B.
- Platform/tenant role authorization.
- Copenhagen DST spring-forward and fall-back handling.
- Availability, buffers, working hours, overrides, holidays, and blackout dates.
- Hold creation, expiry, release, and confirmation.
- Concurrent booking attempts and database conflict handling.
- Opaque token expiry, action scope, revocation, and tenant scope.
- Migration fresh-install and upgrade paths across Control and tenant databases.
- Audit append-only behaviour.
- Recovery/restore procedure evidence before any phase is called complete.

## Current status ledger

**Branch:** `waybook/dashboard-foundation`  
**Baseline preserved:** `waybook-baseline` at `d2e03d7`  
**Production/push status:** no commit, push, deployment, or production/database connection has been made for Waybook work.

| Area | Status | Evidence / next action |
| --- | --- | --- |
| Architecture and package decision | Designed | This document records the agreed product and package boundary. |
| Control database | Database-backed / tested | Local PostgreSQL 16 runs at `127.0.0.1:5440`; `0001_control.sql` migrated and seeded with two active tenant records. |
| Tenant databases | Database-backed / tested | `0001_operational.sql` migrated separately to Nordic and Copenhagen; each has distinct settings, owner, service, and availability seed data. |
| Authentication and roles | Database-backed / browser-verified | Local password-hashed identities, expiring hash-stored sessions, platform-admin and tenant-owner routing work. Other tenant roles still need tests and UI. |
| Tenant routing | Database-backed / browser-verified | Tenant connection keys are allowlisted server-side; tenant workspace resolves the signed-in user’s Control membership. The public `/book` route and all booking APIs resolve `nordic.localhost` or `copenhagen.localhost` only on the server before selecting the approved tenant connection. |
| Booking engine | Database-backed / tested | Tenant-scoped availability reads persisted services, schedules, overrides, bookings, and active holds through `@thebookingkit/core`; public pooled availability is the union of eligible employees’ slots and the hold endpoint revalidates and assigns a currently free eligible employee. Holds use `@thebookingkit/server` retry plus PostgreSQL exclusion constraints. `0002_hold_schedule.sql` stores the customer-visible appointment interval while database blocks reserve intervals including buffers. Local HTTP availability and hold requests passed. |
| Holds, audits, customer tokens, outbox | Database-backed / tested | Host-scoped confirmation atomically changes a valid hold to a booking, upserts the customer, appends booking and tenant audit events, queues a local confirmation outbox record, and stores only a 64-character SHA-256 customer-token hash. A local HTTP confirmation and same-key retry passed with exactly one booking/event/audit/outbox/token row. Customer-management UI, expiry/revocation tests, and external delivery remain. |
| Control dashboard | Database-backed / browser-verified | Authenticated `/control` reads Control tenant state plus tenant booking/team counts and supports reversible suspend/reactivate with platform audit events. Tenants are selected from a compact list and opened as a same-page, server-rendered detail overlay; no client-side state is required for the overlay. |
| Feature modules | Database-backed / browser-verified | Control migration `0002_feature_entitlements.sql` stores feature definitions, plan defaults, and tenant state. `/control` is platform-admin-only and persistently toggles non-baseline modules with immutable audit events. Copenhagen Resources enable/disable was browser-verified. Nordic Clients was disabled, then a fresh `/app/customers` request redirected to `/app` and removed the Clients navigation item; the module was restored afterward. Booking essentials is guarded on public pages/APIs. Team, Calendars, Resources, and Email require equivalent route/action tests as their product modules are added. |
| Tenant provisioning | Manual local seed only | Nordic and Copenhagen are provisioned by local migration/seed scripts. Build the Control create/provision workflow before offering new-client self-service onboarding. |
| Tenant clients dashboard | Database-backed / browser-verified | `/app/customers` lists only the signed-in tenant’s persisted customers and booking counts. Owner/manager `Save client` creates or updates a record server-side; it was desktop and 390px mobile browser-verified with a confirmed public-booking customer plus a manually saved local test customer. Full client profile/history and read-only role test coverage remain. |
| Tenant bookings dashboard | Database-backed / build-verified | `/app/bookings` now reads the tenant-scoped bookings table with the actual client, service, assigned employee, start/end in tenant timezone, status, and source. Add status mutations, filtering, detail/history, and browser verification next. |
| Tenant services dashboard | Database-backed / browser-verified | `/app/services` lists the tenant’s persisted services and opens a same-page right-side editor for add/edit. Owner/manager updates duration, price, buffers, active state, and eligible employees in one server-side mutation; service-to-employee assignments are atomically replaced. An unchanged Studio session save was browser-triggered and PostgreSQL confirmed its service settings and both employee assignments remained persisted. |
| Tenant dashboard navigation | Database-backed / browser-verified | Every implemented tenant page now uses one shared, server-rendered left workspace navigation: Overview, Bookings, and the enabled Clients, Staff, Calendars, and Services modules, with Sign out at the bottom. The active page is indicated and entitlement-disabled modules are omitted instead of merely hidden in the browser. Nordic desktop navigation and the Staff route were browser-verified. |
| Tenant staff dashboard | Database-backed / browser-verified | `/app/team` retains its stable route and Team entitlement, but is presented as Staff. It lists tenant-scoped staff, roles/work type, active state, and bookable services; clicking a row opens a same-page right-side details panel. Owner/manager can persist name, email, phone, role, staff code, job title, specialty/work type, work location, internal notes, active state, service eligibility, weekly RRULE hours, and time-off/availability exceptions. Profile/availability mutations are tenant-scoped, role-authorized, and append tenant audit events. The local migration `0004_staff_profiles.sql` was applied to Nordic and Copenhagen; Nordic’s Staff drawer was browser-verified. Dedicated persistence/browser mutation and Copenhagen checks remain. |
| Tenant calendars dashboard | Database-backed / browser-verified | `/app/calendars` is guarded by the Calendars entitlement and is linked to active staff. Compact staff and service selectors replace the previous cards. It renders a navigable week time-grid in the tenant timezone: real confirmed bookings are positioned by their persisted start/end timestamps, while adjacent bookable periods are merged and calculated through `@thebookingkit/core` for the selected service. Staff hours, time-off, and exceptions are intentionally managed in Staff details rather than Calendar. Clicking a booking opens a responsive appointment drawer with customer edit, public-booking-style direct date/time slot rescheduling, arrived/completed/no-show statuses, and a Cancel control that updates status to `cancelled`; owner/manager actions are tenant-scoped, append booking/audit events, and reschedule only after availability revalidation plus PostgreSQL conflict protection. Save changes, Reschedule appointment, and Update status begin disabled and become active only after their own field, slot, or different status selection changes; this transition was browser-checked without submitting a mutation. The reschedule picker now has a seven-day window and four slots per row; this was desktop browser-checked. Local Nordic verification persisted `arrived` and a 09:00→15:00 reschedule. Copenhagen and disabled-module checks remain. |
| Public booking sites | Database-backed / tested / browser-verified | `/book` uses a tenant-first embedded-form treatment: the customer’s business name leads every stage and Waybook appears only as a minimal “Powered by Waybook” footer. The actual flow is service → seven-day selector/four-column time grid → review → confirmation, with server-host tenant resolution and live data. It fetches availability from `@thebookingkit/core`, renders pooled eligible-employee times once, creates a server-assigned hold with `@thebookingkit/server` conflict handling, and confirms through the transactional API. Nordic desktop confirmation and 390px mobile review passed; both name the assigned employee. The seven-day/four-column picker was desktop browser-checked; its mobile recheck remains. Copenhagen has the same code path but has not yet had its own browser flow run. |
| Automated Waybook tests | Partially tested | `npm run waybook:test:pooled` verifies two eligible employees: one hold leaves the shared time available, the second is assigned to the other employee, and then the time disappears. Add repeatable tests for tenant isolation, roles, DST, buffers, expiry, wider concurrency, token scope/revocation, migrations, and recovery. |
| Desktop/mobile verification | Partial / browser-verified | Nordic public booking now has desktop confirmation and 390px mobile time/review verification, including server-selected employee display and the fully occupied shared-time state. The Clients dashboard has also been verified. Repeat for Copenhagen and the remaining authenticated modules before Phase 1 is called complete. |

### Deferred identity and workspace-access work — later

- **Google / Better Auth rebuild:** replace or extend the current local password-only sign-in with Google-backed Better Auth while retaining the existing Control database as the authoritative identity, membership, and approved tenant-connection registry. Do not import the separate `/Users/amit/Documents/Waybook` repository’s static dashboard, schema, or database-pool wiring.
- **Invite-only workspace claiming:** rebuild the useful server-side invitation-claim pattern in the Control database for the existing `identities` and `tenant_memberships` model. It must use verified provider identity data only, accept an unexpired invitation transactionally, create/activate the correct membership once, audit the event, and then resolve the approved tenant connection server-side.
- **Definition of done:** configured OAuth client/redirect origins and secrets; Control migration and server-only mutation; invite acceptance, repeat acceptance, expiry, revocation, tenant-isolation, and role tests; Nordic and Copenhagen browser verification. Keep password login only if explicitly retained as a supported fallback.

## Change discipline

- Preserve `waybook-baseline` unchanged permanently.
- Work only on `waybook/dashboard-foundation` unless explicitly told otherwise.
- Make the smallest safe change; do not activate unrelated packages or connect external services.
- Inspect and test the user-facing result on desktop and mobile before declaring a phase complete.
- Update this file immediately after achieving or revising any milestone.

## Current implementation snapshot — 2026-11-04

**Completed and real:** local Control and two isolated tenant databases; session/membership routing; host-resolved public booking with holds and transactional confirmation; Control feature entitlements; and database-backed tenant dashboards for bookings, customers, team, services, and calendars. Tenant staff, services, schedules, service eligibility, clients, bookings, feature states, and calendar views persist locally rather than existing as page-only UI.

**Verified evidence so far:** targeted database/HTTP checks, successful production builds at feature milestones, and browser checks of Nordic’s public booking flow, client dashboard, feature controls, service/editor flows, team/editor flows, left navigation, and calendar selectors/time grid. This is not Phase 1 complete.

### Pooled employee availability — 2026-11-05

**Status: Database-backed / tested / browser-verified.** Nordic’s Studio session is assigned to both Maria Lee and Sofie Andersen. The public form now renders the deduplicated union of their slots. It does not receive or choose an employee ID: on selection the hold endpoint recalculates eligible employees for the exact interval, creates the hold for one who is still free, and falls through to another candidate if PostgreSQL reports a concurrent conflict.

**Proof:** `npm run waybook:test:pooled` passed against local Nordic data: one temporary hold retained the shared slot, the second hold was assigned to the other employee, and the slot disappeared after both employees were held. Desktop browser confirmation showed Maria Lee; 390px mobile review showed the server-selected employee, and the time picker excluded a fully occupied shared time. PostgreSQL exclusion constraints and the existing confirmation transaction remain authoritative.

**Still required before Phase 1 completion:** automated coverage for isolation/roles/DST/buffers/hold expiry/concurrency/tokens/migrations/recovery; browser verification for Copenhagen and entitlement-disabled routes/actions; bookings detail/status controls; fuller customer history and role controls; resources/email workflows; automated tenant provisioning; environment/rate-limit/backup hardening; and end-to-end desktop/mobile checks across all required paths.
