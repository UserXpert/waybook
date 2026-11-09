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

Availability overrides have two authoritative meanings: an unavailable override
without hours removes the whole local day; an unavailable override with both
start/end hours removes only that local interval (for a break or short leave).
Alternative-hours overrides replace the working window for their date. The core
engine enforces these semantics before slots are shown or a manual booking is
accepted.

**Tested:** the core slot-engine suite proves a 12:00–13:00 unavailable
override removes only its overlapping slots and preserves bookable time before
and after it. Browser proof of a staff-created partial block remains open.

The browser does not select an employee ID. When a customer selects a time, the hold endpoint recalculates eligible employees for that exact interval and assigns one who is actually free. If a concurrent PostgreSQL conflict occurs, the endpoint falls through to another candidate.

Location-aware booking: public availability accepts a tenant-scoped location,
validates that both the service and an eligible active employee are assigned
there, and carries the location through the hold, booking block, and confirmed
booking. The public flow defaults to the primary online location and presents a
location chooser when more than one online location is available.

Local proof on 2026-11-05: location-qualified availability returned 48 slots,
and the Nordic public flow progressed from service and location selection to
available times on desktop and at 390px mobile.

Location opening hours are also authoritative for public availability: every
returned appointment must fit wholly inside an opening interval in the
location's timezone. Local verification for Nordic Studio returned 31 slots,
all inside its weekday 09:00–17:00 Copenhagen window.

Tenant calendar operations use a 30-minute start cadence, including manual
booking, rescheduling, and drag/drop. Each candidate still has to satisfy the
server-side conflict checks. Calendar drag/drop is an operational reassignment:
within the displayed location it can move an existing appointment to any active
staff member and any free interval of its existing duration, regardless of
public-booking schedules, service eligibility, or resource availability. The
write action rechecks overlapping held/confirmed staff blocks transactionally.
Public and manual appointment creation remain subject to their stricter
service, schedule, location, and resource rules. Waybook has no service-buffer
concept: a booking reserves its customer-facing interval exactly, so adjacent
appointments are valid.

Resources have a tenant-managed mutual-exclusivity setting. An exclusive room,
chair, bay, or equipment unit admits only one overlapping hold/booking;
turning the setting off makes it a shared room, so multiple staff can use it
concurrently while its assignment remains visible on each booking. Existing
resources default to exclusive.

Tenant operators can add a dated location closure (for example, a holiday or
private event). A local UI/API proof added a Friday closure, returned zero
public slots for that date, then removed the test closure.

Calendar drag/drop obtains its visible targets from the exact booking duration
and the current calendar location. It highlights every active staff/time cell
without an overlapping held or confirmed appointment, excluding the booking's
own block. This deliberately does not reuse public availability, which would
incorrectly grey otherwise free operational reschedule destinations. No
persisted blocked-start/end fields are read by the Waybook availability adapter.

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

At confirmation, the booking records an immutable `booked_price_cents` snapshot.
This preserves the booked service value used by tenant reporting when a service's
catalogue price changes later. The `0005_booking_price_snapshot.sql` migration
backfilled existing local bookings once from their then-current service price;
new bookings always write the confirmation-time price.
An isolated local public confirmation after the migration verified that its
stored snapshot matched the service price at confirmation.

Payment records are deliberately separate from booked price: `0009_payment_records.sql`
adds an append-only, tenant-scoped ledger of payment and refund entries linked
to a booking. Owner/manager calendar actions validate the booking and amount,
then append the payment record plus matching booking and tenant audit events in
one transaction. Payment entries are corrections by addition (refund), never
mutation or deletion. The migration is applied to the local Nordic and
Copenhagen databases; Nordic browser proof recorded a 700 DKK card payment
and confirmed its ledger, booking event, and audit record.

Local HTTP confirmation and same-key retry proved exactly one booking, event, audit, outbox record, and token row. Customer-facing management UI, expiry/revocation coverage, and external delivery remain open.

Commerce read-model bridge: `0036_booking_commerce_sales_read_model.sql`
creates exactly one tenant-scoped `commerce_sales.booking_id` identity for
each appointment, including a backfill for existing bookings. This is not a
new payment ledger: appointment payment and refund history remains solely in
`payment_records`, so totals and booking audits are not duplicated. Local
verification on 2026-11-07 found complete Nordic and Copenhagen coverage with
zero copied commerce transactions; manager desktop/mobile browser checks
confirmed linked Sales and Booking views.

## Canonical public routes

### Planned branded booking and website embed — Designed (2026-11-08)

The public booking engine will retain pooled **Anyone** assignment: a client
selects a location and service, and the server chooses a free eligible staff
member. Named staff selection is intentionally out of scope. Tenant-managed
public settings will control brand/logo, accessible colour, booking copy,
policy version, locale/currency, service catalogue visibility, price display,
and a call-us route for services that must not be booked online. Shareable
booking links may preselect a location, service, or category.

External websites will load an allowlisted Waybook launcher script. It opens
the same tenant booking flow in an accessible iframe overlay, with a normal
booking-link fallback. The embed must constrain framing with `frame-ancestors`,
strictly validate parent-origin messages, attribute its verified source, and
never expose tenant secrets or allow the host page to influence booking
authorization or availability.

Public booking uses the same-origin tenant paths such as `/nordic/book` and `/copenhagen/book`. Availability, hold, and confirmation requests preserve that prefix and resolve through the server-side Control registry.

Local proof:

- Nordic desktop route loaded availability and the canonical app navigation.
- Copenhagen `/copenhagen/book` loaded at 390px mobile.
- Existing pooled confirmation proof remains valid.

Still required: a complete hosted canonical-path confirmation and a repeated desktop/mobile review after future booking-domain changes.

## Required tests still open

- Copenhagen DST spring-forward and fall-back behaviour.
- Browser proof for working hours, staff-created partial overrides, holidays,
  blackout dates, buffers, and resources.
- Hold expiry and release.
- Wider concurrent booking attempts and conflict translation.
- Opaque customer-token expiry, action scope, revocation, and tenant scope.
- Booking audit append-only behaviour and local-outbox handling.
