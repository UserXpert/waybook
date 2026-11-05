# Booking engine: availability, holds, confirmation, and time invariants

## Status

**Database-backed / tested / browser-verified (pooled availability).**

The public flow is:

```text
Service -> eligible staff/resource -> date/time -> hold -> customer details -> confirmation
```

Timestamps are stored in UTC and rendered in the tenant timezone (`Europe/Copenhagen` by default).

## Availability and pooled employees

Availability reads persisted services, schedules, overrides, bookings, and active holds using `@thebookingkit/core`. Public slot presentation is the deduplicated union of slots for all eligible employees.

The browser does not select an employee ID. When a customer selects a time, the hold endpoint recalculates eligible employees for that exact interval and assigns one who is actually free. If a concurrent PostgreSQL conflict occurs, the endpoint falls through to another candidate.

Proof recorded on 2026-11-05:

- Nordic Studio's Studio session was eligible for Maria Lee and Sofie Andersen.
- `npm run waybook:test:pooled` passed: the first temporary hold retained the shared slot, the second hold used the other employee, and the time disappeared only after both employees were held.
- Desktop confirmation showed the server-selected employee; 390px mobile review did too, and excluded a fully occupied shared time.

## Holds and booking conflict protection

- Holds expire and occupy availability until expiry, release, or confirmation.
- The hold endpoint uses `@thebookingkit/server` serializable retry plus PostgreSQL exclusion constraints.
- `0002_hold_schedule.sql` preserves the customer-visible appointment interval while database reservation intervals include service buffers.
- Constraints, not the UI, are authoritative for provider/resource conflicts.
- Confirmation from a valid hold is transactional and idempotent.

## Confirmation, audit, outbox, and customer tokens

Confirmation atomically changes a valid hold into a booking, upserts the customer, appends booking and tenant audit events, queues a local confirmation outbox record, and stores only a 64-character SHA-256 customer-token hash.

Local HTTP confirmation and same-key retry proved exactly one booking, event, audit, outbox record, and token row. Customer-facing management UI, expiry/revocation coverage, and external delivery remain open.

## Canonical public routes

Public booking uses the same-origin tenant paths such as `/nordic/book` and `/copenhagen/book`. Availability, hold, and confirmation requests preserve that prefix and resolve through the server-side Control registry.

Local proof:

- Nordic desktop route loaded availability and the canonical app navigation.
- Copenhagen `/copenhagen/book` loaded at 390px mobile.
- Existing pooled confirmation proof remains valid.

Still required: a complete hosted canonical-path confirmation and a repeated desktop/mobile review after future booking-domain changes.

## Required tests still open

- Copenhagen DST spring-forward and fall-back behaviour.
- Working hours, overrides, holidays, blackout dates, buffers, and resources.
- Hold expiry and release.
- Wider concurrent booking attempts and conflict translation.
- Opaque customer-token expiry, action scope, revocation, and tenant scope.
- Booking audit append-only behaviour and local-outbox handling.
