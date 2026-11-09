# Waybook documentation manifest

## Purpose

This is the compact, factual handoff for Waybook. It replaces the former monolithic `WAYBOOK_MVP.md` as the default entry point.

Waybook Phase 1 is a real multi-tenant appointment-operations SaaS for clinics
first, then salons and other appointment businesses. It has three operating
spaces: Waybook Control, Nordic Studio, and Copenhagen Physio. It is not a
static dashboard or a client production environment.

## Documentation protocol — minimise context, preserve truth

1. At the start of a Waybook task, read **this manifest only**.
2. Use the routing table below to read the one relevant topic document. Read a second document only when the work changes a shared contract between them.
3. Update the relevant topic document after a meaningful implementation, verification, or scope change. Update this manifest only for a milestone, current-status, or cross-cutting decision change.
4. Do not duplicate detailed acceptance criteria or historical evidence across files. Link to the owning document instead.
5. Every outcome must be labelled accurately: **Designed**, **Mock**, **Database-backed**, **Tested**, and/or **Browser-verified**. UI alone is never proof of a working feature.

This protocol deliberately does **not** require reading every document for a small feature.

| Work area | Read first | Update when |
| --- | --- | --- |
| Database topology, tenant URL, authorization, audit boundary | [01_architecture.md](01_architecture.md) | A data boundary, routing, or security invariant changes |
| Login, sessions, Google SSO, invitations, Create Business, provisioning | [02_auth_provisioning.md](02_auth_provisioning.md) | Identity or onboarding/provisioning behaviour changes |
| Availability, slots, holds, bookings, tokens, DST, confirmation | [03_booking_engine.md](03_booking_engine.md) | Booking-domain behaviour or proof changes |
| Control, tenant dashboard, feature flag, Staff, Calendars, public UI | [04_modules_ledger.md](04_modules_ledger.md) | A module/UI capability or its verification changes |
| Products, sales, wallet, gift cards, memberships, packages, payment references | [05_commerce_foundation.md](05_commerce_foundation.md) | A commerce boundary, migration, or vertical slice changes |
| AWS database ownership and provider cutover | [06_aws_rds_cutover.md](06_aws_rds_cutover.md) | Hosting, networking, migration, backup, or provider decision changes |
| Prioritised remaining work and pilot stop gate | [07_delivery_backlog.md](07_delivery_backlog.md) | A slice is added, completed, deferred, or the pilot release boundary changes |

## Product and environment boundary

- **Branch:** `main`
- **Baseline:** `waybook-baseline` at `d2e03d7`; never alter it.
- **Hosted environment:** an isolated, seeded Vercel/Neon test environment, never a client production environment.
- **Local topology:** PostgreSQL 16 at `127.0.0.1:5440` with `waybook_control`, `waybook_nordic_studio`, and `waybook_copenhagen_physio`.
- **Deployment:** `main` has automatic Vercel Git deployments.
- **Canonical hosted origin:** `https://waybook-booking.vercel.app`.

## Current delivery ledger

| Area | Status | Current factual state |
| --- | --- | --- |
| Core topology and tenant isolation | Database-backed / tested | Control registry plus one operational PostgreSQL database per tenant; see Architecture. |
| Tenant URL model | Database-backed / tested / browser-verified | Canonical shared-origin paths are `/{business}/app` and `/{business}/book`; tenant members receive their membership role while platform admins receive a dynamic read-only Control view. Old Nordic/Copenhagen Vercel aliases were retired on 2026-11-05. |
| Local session/auth | Database-backed / browser-verified | Password-hashed identities, expiring hash-stored sessions, platform-admin and owner routing work locally. Better Auth/Google/invite-only access is not implemented. |
| Booking engine | Database-backed / tested / browser-verified | Persisted schedules, pooled employee slots, server-assigned holds, exclusion-constraint protection, confirmations, audits, outbox and token hashes; see Booking engine. |
| Control and tenant dashboards | Database-backed / browser-verified (partial) | Control, bookings, services, clients, Staff, Calendars and public booking have real persisted paths. Module-specific proof and gaps are in Modules ledger. |
| Dashboard product direction | Database-backed / tested / browser-verified (partial) | Nordic's tenant Overview has four desktop/mobile-verified operational widgets: upcoming appointments, daily staff booking workload, monthly appointment outcomes, and real staff target progress. Capacity, retention, and Control dashboard work remains designed; see Modules ledger. |
| Commerce-to-booking bridge | Database-backed / tested / browser-verified (partial) | Catalogue editability, bounded decoder-validated media, and the one-sale-per-booking read model are complete locally. Product add-ons, package redemption, and gift-card tender must converge through that sale without duplicating appointment payments; see Commerce foundation. |
| Automated business provisioning | Designed | Nordic and Copenhagen remain manually seeded. Create Business must wait for Google SSO and invitation claiming. |
| Bounded delivery plan | Designed / maintained | P0/P1 pilot backlog and explicit stop rules are in Delivery backlog; no new feature work is implicit outside that list. |

## Clinic-first, operations-only boundary — Designed (2026-11-08)

The first commercial pilot is for clinics, but the same product boundary
applies to every vertical. Waybook is an appointment-operations product:
scheduling, availability, people, rooms/equipment, service history, payments,
and versioned policy acknowledgement. It may hold operational client data such
as contact details, appointment/service history, and non-sensitive booking
instructions. It must use tenant-configurable display terminology (for example
**patient/client** and **practitioner/staff**) without creating separate clinic
and salon products.

Waybook is not an EHR or a professional-record system. Diagnoses, treatment or
professional notes, prescriptions, insurance claims, clinical images, and
sensitive health intake are out of scope across clinics, salons, and every
other tenant type. General notes and forms must not become a workaround for
that boundary; a later regulated-records product would need its own explicit
data, compliance, retention, access, and integration decision. It is a future
optional premium EHR add-on for clinics, never a prerequisite or hidden mode
of the core appointment product.

## Working-product standard

- Functional work follows: persisted data → server authorization → read/mutation path → focused test → desktop/mobile browser verification.
- Database constraints, rather than UI checks, are authoritative for conflict prevention and tenancy boundaries.
- Batch related visual changes and verify once. Reserve production builds and deeper checks for behaviour, security, migration, or integration boundaries.
- Every icon-only control uses a semantic SVG icon inside the shared `waybook-icon-button` layout, with a fixed square target and grid centering on both axes; text glyphs and hand-drawn CSS icons are not used for new controls.
- After two failed attempts at one obstacle, reassess using new evidence.

## Phase 1 gates still open

1. Better Auth + Google SSO, invitation claiming, and automated business provisioning.
2. Automated coverage for tenant isolation, roles, DST, buffers, hold expiry, concurrency, token scope/revocation, migrations, and recovery.
3. Copenhagen and entitlement-denied browser checks, remaining authenticated module checks, hosted canonical booking confirmation, and complete desktop/mobile end-to-end coverage.
4. Rate-limit, backup/recovery, migration, and environment hardening.
