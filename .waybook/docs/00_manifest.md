# Waybook documentation manifest

## Purpose

This is the compact, factual handoff for Waybook. It replaces the former monolithic `WAYBOOK_MVP.md` as the default entry point.

Waybook Phase 1 is a real multi-tenant booking SaaS with three operating spaces: Waybook Control, Nordic Studio, and Copenhagen Physio. It is not a static dashboard or a client production environment.

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
| Automated business provisioning | Designed | Nordic and Copenhagen remain manually seeded. Create Business must wait for Google SSO and invitation claiming. |

## Working-product standard

- Functional work follows: persisted data → server authorization → read/mutation path → focused test → desktop/mobile browser verification.
- Database constraints, rather than UI checks, are authoritative for conflict prevention and tenancy boundaries.
- Batch related visual changes and verify once. Reserve production builds and deeper checks for behaviour, security, migration, or integration boundaries.
- After two failed attempts at one obstacle, reassess using new evidence.

## Phase 1 gates still open

1. Better Auth + Google SSO, invitation claiming, and automated business provisioning.
2. Automated coverage for tenant isolation, roles, DST, buffers, hold expiry, concurrency, token scope/revocation, migrations, and recovery.
3. Copenhagen and entitlement-denied browser checks, remaining authenticated module checks, hosted canonical booking confirmation, and complete desktop/mobile end-to-end coverage.
4. Rate-limit, backup/recovery, migration, and environment hardening.
