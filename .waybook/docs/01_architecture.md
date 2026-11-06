# Architecture, tenancy, routing, and security

## Architecture status

**Status: Database-backed / tested / browser-verified (routing).**

Waybook is a hybrid multi-tenant system, not a shared tenant dashboard with browser-selected database settings.

```text
Browser request
  -> same-origin tenant path or approved local hostname
  -> server middleware / tenant resolver
  -> Control tenant registry + membership check
  -> approved operational database connection
  -> tenant-scoped data and audit records
```

## Database topology

### Control PostgreSQL database

The Control database is the authority for identities, platform administrators, sessions, tenant registry and lifecycle, approved domains and connection references, tenant memberships, plans, feature flags, provisioning/migration/backup status, and immutable platform audit events.

### One operational PostgreSQL database per tenant

Each tenant database contains staff, services, availability, resources, customers, holds, bookings, booking events, tenant audit events, and future payment records. Every operational record also retains immutable `tenant_id` as defence in depth.

Initial local databases:

```text
waybook_control
waybook_nordic_studio
waybook_copenhagen_physio
```

The local Next development server keeps its process-local Control and tenant
`postgres.js` clients on `globalThis`. This prevents hot-reloaded server
modules from creating abandoned pools during a long local session; each client
remains bounded by the shared five-connection factory limit.

The hosted Vercel test environment uses isolated Neon databases for the same three logical databases. It is not client production.

## Tenant routing

### Canonical paths

Tenant experiences share one origin:

```text
https://waybook-booking.vercel.app/nordic/app
https://waybook-booking.vercel.app/nordic/book
https://waybook-booking.vercel.app/copenhagen/app
https://waybook-booking.vercel.app/copenhagen/book
```

Middleware rewrites a valid `/{tenant}/{app|book|login|api}` path internally and creates the tenant-route context only on the server. Incoming `x-waybook-tenant-route` headers are stripped before a route is resolved, so a caller cannot forge the context.

Local legacy hosts (`nordic.localhost:3333`, `copenhagen.localhost:3333`) are still useful for development. Production tenant-host aliases `nordic-waybook-booking.vercel.app` and `copenhagen-waybook-booking.vercel.app` were explicitly removed on 2026-11-05.

### Tenant resolution rules

- Resolve a tenant only server-side through the Control domain registry.
- The browser never supplies a database identifier, connection string, or arbitrary tenant connection target.
- Authenticated tenant users require a membership for the resolved tenant. A platform administrator may open any resolved active tenant from Control with a runtime-only `read-only` role; it is not a tenant membership and cannot pass owner/manager mutation checks.
- Public booking endpoints resolve the tenant server-side before accessing the approved tenant connection.
- Direct `/app` remains a Control destination for platform administrators, while a resolved `/{business}/app` path is a dynamic read-only Control view.

The root post-login route sends a tenant member to `/{business}/app`; a platform administrator goes to `/control`. Control workspace links are server-derived from the current Waybook origin and tenant route slug, not a hardcoded business mapping.

## Security and data invariants

- Nordic must never query or mutate Copenhagen records, and vice versa.
- Every server mutation and read checks identity, role, membership, and tenant context.
- Platform roles are separate from tenant roles: `platform-admin`, `owner`, `manager`, `staff`, `read-only`.
- Audit records are append-only and record actor, tenant, target, action, request/correlation ID, timestamp, and structured metadata.
- Versioned migrations run separately for Control and each tenant database and their state is recorded in Control.

## Foundation packages

Approved adapted foundations:

- `@thebookingkit/core`: availability, RRULE, timezone, buffers, scheduling, resource handling, booking limits, validation.
- `@thebookingkit/server`: serializable retry, conflict translation, date/ICS, adapter patterns, selected cryptographic utilities.
- `@thebookingkit/db`: Drizzle + `postgres.js`, exclusion constraints, append-only audit patterns, useful tests.

Must not be adopted as-is: Booking Kit organisation scoping/auth/schema, signed booking-management tokens, in-memory rate limits, D1/SQLite, demo data, payments, queues, kiosk, recurring bookings, embeds, webhooks, workflows, calendar sync, and SMS.

## Verification record

- Focused shared-origin route test: 3/3 passed.
- Production Next build passed.
- Production Control opened a Copenhagen workspace link at `waybook-booking.vercel.app/copenhagen/app`.
- Local platform-admin browser verification opened Copenhagen through its route-derived read-only Control view; the Services mutation entry point was absent.
- Retired Copenhagen host returned Vercel `404 DEPLOYMENT_NOT_FOUND` after alias removal.

## Remaining architecture proof

- Repeatable cross-tenant read and mutation denial tests.
- Complete platform/tenant role test matrix.
- Migration fresh-install/upgrade evidence and recovery/restore procedure.
- Durable shared rate limiting and operational hardening.
