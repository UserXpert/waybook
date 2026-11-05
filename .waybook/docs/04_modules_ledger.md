# Modules and UI capability ledger

## Module policy

Waybook has one shared product codebase. Control decides which modules a business can use; modules are never separately built dashboards.

Booking essentials is baseline: services, eligible staff, availability, public booking, holds, and confirmations. Independently controlled modules are Clients, Staff, Calendars, Resources, and Email notifications. Only platform administrators change feature state; each change creates immutable Control audit history. A disabled module is hidden **and** server-side denied; data is not deleted and reappears if re-enabled.

## Control

**Status: Database-backed / tested / browser-verified.**

- Reads tenant lifecycle, plan, migration/backup state, tenant booking volume, and active staff count.
- Supports reversible suspend/reactivate with platform audit events.
- Uses same-page server-rendered tenant details, not client-only overlay state.
- Workspace links are derived server-side and use the canonical shared origin: `/{business}/app`; a platform admin opens that resolved tenant in read-only mode, while owner/manager-only mutations remain unavailable.
- Production Control verified Copenhagen’s canonical link on 2026-11-05.
- A local platform-admin browser check opened Copenhagen dynamically in read-only mode; the Services add/edit entry point was unavailable.

Create Business, provisioning, two-step deletion, and related audit/database cleanup are not yet implemented; see Auth and provisioning.

## Tenant workspace shell

**Status: Database-backed / browser-verified (Nordic).**

The shared server-rendered navigation contains Overview, Bookings, enabled Clients/Staff/Calendars/Services modules, and Sign out. Entitlement-disabled modules are omitted from navigation and rejected server-side. Canonical dashboard paths use `/{business}/app/...`.

## Services

**Status: Database-backed / browser-verified.**

`/app/services` lists persisted tenant services and supplies a right-side add/edit panel. Owner/manager updates duration, price, buffers, active state, and eligible employees atomically. An unchanged Studio session save preserved settings and both assignments in PostgreSQL.

## Clients

**Status: Database-backed / browser-verified.**

`/app/customers` lists tenant-scoped persisted customers and booking counts. Owner/manager Save client creates/updates server-side. Nordic desktop and 390px mobile were verified with a public-booking customer and a manually saved test customer. Full profiles/history and read-only role tests remain.

## Staff

**Status: Database-backed / browser-verified.**

The former Team label is Staff. `/app/team` has tenant-scoped profiles and a right-side details drawer. Owner/manager can persist contact data, role, staff code, job title, specialty/work type, location, internal notes, active state, service eligibility, weekly RRULE hours, and time-off/availability exceptions. The `0004_staff_profiles.sql` migration was applied to Nordic and Copenhagen. Nordic drawer was browser-verified; dedicated persistence and Copenhagen verification remain.

## Bookings and Calendars

### Bookings

**Status: Database-backed / build-verified.**

`/app/bookings` reads tenant-scoped bookings with actual customer, service, assigned employee, tenant-timezone start/end, status, and source. Filtering, detail/history, status mutations, and browser proof remain.

### Calendars

**Status: Database-backed / browser-verified (Nordic).**

`/app/calendars` is Calendars-entitlement guarded and uses compact staff/service selectors. It renders a tenant-timezone week grid of confirmed bookings and merged bookable periods calculated with `@thebookingkit/core`. Staff hours and exceptions are managed in Staff details rather than Calendar.

Appointment drawer capabilities: customer edit, public-booking-style direct slot rescheduling, arrived/completed/no-show statuses, and Cancel (sets `cancelled`). Owner/manager mutations are tenant-scoped, audited, and reschedule after availability revalidation plus PostgreSQL conflict protection. Save, Reschedule, and Update status start disabled and activate only for their own changed section. The picker has seven days and four slots per row. Nordic browser verification persisted `arrived` and a 09:00 → 15:00 reschedule. Copenhagen and disabled-module checks remain.

## Public booking

**Status: Database-backed / tested / browser-verified (local).**

Tenant-first public booking is available at `/{business}/book`, resolves only through Control, preserves its tenant prefix for availability/hold/confirmation, and displays the server-assigned employee at review/confirmation. See [Booking engine](03_booking_engine.md) for the pooled availability contract and proof.

## Remaining module work

- Resources and Email notification workflows.
- Browser verification for Copenhagen and entitlement-denied routes/actions.
- Complete Bookings detail, filtering, history, and status behaviour.
- Repeat desktop/mobile acceptance for each production-ready module.
