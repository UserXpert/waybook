# Modules and UI capability ledger

## Module policy

Waybook has one shared product codebase. Control decides which modules a business can use; modules are never separately built dashboards.

Booking essentials is baseline: services, eligible staff, availability, public booking, holds, and confirmations. Independently controlled modules are Clients, Staff, Calendars, Resources, and Email notifications. Only platform administrators change feature state; each change creates immutable Control audit history. A disabled module is hidden **and** server-side denied; data is not deleted and reappears if re-enabled.

## Product direction — Designed

Waybook will be the **calm operating system for appointment businesses**. It
must help a business run today, optimise tomorrow, and retain clients next
month—not present decorative dashboard statistics.

The reference model is deliberately combined:

- **Timely:** approachable language, clear owner dashboard, client history,
  booking operations and mobile-friendly simplicity.
- **Boulevard:** operational calendar, appointment lifecycle, rich drawer,
  gap-aware scheduling, waitlist and capacity reporting.
- **Jane:** optional clinic-grade room/equipment and client-context patterns;
  do not import clinical documentation or insurance scope into the shared core.

### Product rules

- Every chart or widget must answer a next-action question.
- Use real, tenant-scoped data and link every metric to its source view.
- Show **booked service value**, not revenue, until payments are persisted.
- Do not show conversion until booking-view/drop-off events exist.
- Do not show AI predictions until sufficient historical data and an
  explainable model exist.
- Keep vertical complexity optional: resources/rooms/bays, intake/forms and
  communications are modules, not universal dashboard requirements.

### Prioritised dashboard capabilities

| Priority | Capability | Primary user decision | Data readiness | Status |
| --- | --- | --- | --- | --- |
| 1 | Today Command Centre | What needs attention before the next appointment? | Current bookings, statuses, staff, services and availability | Designed |
| 1 | Capacity Command | Where are gaps, overload and unused staff/resource capacity? | Current bookings, schedules, service eligibility; Resources later | Designed |
| 1 | Operational Calendar and appointment drawer | What should reception or staff do with this appointment now? | Current calendar, customer, service, employee and status data | Partly database-backed; upgrade designed |
| 1 | Booking health | Is cancellation/no-show behaviour or lead time becoming a problem? | Current booking statuses and timestamps | Designed |
| 2 | Control Fleet Command | Which businesses need platform intervention now? | Tenant lifecycle, migration, backup, feature and booking data | Designed |
| 2 | Service intelligence | Which services need more supply, different hours, or review? | Bookings, service prices, eligible staff and availability | Designed |
| 2 | Client Pulse | Who is new, returning, due back or at risk of lapsing? | Requires service cadence, richer client history and tags | Designed |
| 3 | Smart waitlist | Which customer should fill a newly opened slot? | Waitlist and preference records exist; automated matching/notification remains | Partly database-backed |
| 3 | Resource optimisation | How should rooms, chairs, bays and equipment be allocated? | Requires Resources module and resource bookings | Designed |
| Later | Predictive no-show/demand signals | What might happen next and why? | Requires sufficient event history and explainable models | Designed |

### Tenant dashboard model

#### Today Command Centre

- **Database-backed / build-verified / browser-verified (local Nordic,
  desktop and 390px mobile).** The tenant Overview is deliberately limited
  to four operational widgets: three upcoming confirmed/arrived appointments,
  a tenant-local daily staff booking-workload comparison, current-month
  appointment outcomes, and current-month staff booked-value target progress.
  The page links each widget to its canonical operational surface.
- The Overview visual language is being refreshed in an original, calm
  operations style: warm neutral surfaces, Waybook forest/lime/peach tokens,
  clear metric hierarchy, and action-led cards. It is not a reproduction of
  another product's branded assets or copy.
- Staff workload bars compare today’s booked appointments with other active
  staff. They do not claim to show utilisation or remaining availability.
- Monthly outcomes count bookings, arrived, completed, and bookings with at
  least one payment record. The last is not net paid revenue. Target progress
  remains empty until an owner or manager has saved a real monthly staff
  booked-value target; the dashboard never fabricates one.
- It intentionally does not claim remaining capacity, staff currently working,
  late arrivals, unfilled gaps, or predictive demand: their required semantic
  data contracts are not yet present.

#### Capacity Command

- Booked hours divided by available hours, per-staff utilisation, predictive
  demand, unfilled gaps, and resource capacity remain designed work. The
  current Overview workload comparison is deliberately not presented as any of
  those measures.
- **Database-backed / browser-verified (local Nordic):** Reports includes a
  next-seven-days Capacity Snapshot: confirmed/arrived scheduled time,
  active-staff recurring weekly capacity, and their ratio. It explicitly does
  not deduct time-off, location closures, buffers, or resources, so it is a
  workload signal rather than a full availability guarantee.
- Reports also breaks that same next-seven-days workload down per active staff
  member, showing scheduled minutes, recurring capacity, and their ratio.

#### Client Pulse and Service Intelligence

- **Database-backed / browser-verified (local Nordic):** Reports now exposes
  Client Pulse for the selected 7-, 30-, or 90-day range: active clients,
  first-ever (new) clients, returning clients, and lapsed clients. Lapsed is
  explicitly defined as a client active 90–180 days ago with no appointment in
  the last 90 days; cancelled appointments are excluded.
- **Database-backed / build-verified / browser-verified (local Nordic):**
  Services can carry an optional 1–730-day recommended return interval.
  Reports derives due-in-the-next-30-days and overdue counts from each
  client’s latest non-cancelled cadenced service, in the tenant timezone. A
  client drawer displays the exact return date and source service. This is a
  decision signal only: it sends no message and makes no predictive claim.
- Last service, preferred staff, tags, notes and communication state.
- **Database-backed / browser-verified (local Nordic):** `/app/reports` gives
  a selectable trailing 7-, 30-, or 90-day service and assigned-staff view of
  booking count, delivered count, lost count, and immutable booked/delivered
  service value. It also shows net paid revenue from its separate append-only
  payment/refund ledger, with gross collected and refunded amounts; scheduled,
  delivered, and lost service totals are explicitly not payment revenue. A
  recent payment-activity table identifies the client, service, type, method,
  amount, and internal note for each entry. Location Performance additionally
  breaks bookings, booked value, and paid revenue out by tenant location, with
  the appointment-date versus payment-date distinction made explicit. Its
  Booking Health section reports cancellation/no-show
  rate and counts plus average booking lead time from persisted creation and
  start timestamps. Its lead-time distribution separates same-day, 1–6-day,
  7–29-day, and 30+-day bookings. Staffing pressure and cadence remain open.
- **Database-backed / build-verified / browser-verified (local Nordic,
  desktop and 390px mobile):** `/app/targets` stores owner/manager-set monthly
  targets per tenant for an active staff member or service. A target measures
  either non-cancelled bookings or immutable booked service value; it is never
  paid revenue. The page calculates actuals inside the tenant-local calendar
  month and the server action records an immutable audit event for every
  saved/replaced target. Local Nordic browser verification saves a monthly
  staff booked-value target, verifies its table amount/progress, then verifies
  the Overview target ring’s tenant-scoped booked value, target, progress, and
  remaining amount.
- **Database-backed / browser-verified (local Nordic):** Client history now
  has a Book appointment action that opens the calendar’s right-side creation
  panel with that tenant-scoped client’s contact details prefilled; the booking
  action still validates availability and updates the canonical client record
  by email on confirmation.

#### Waitlist

- **Database-backed / build-verified / browser-verified (local Nordic,
  desktop and 390px mobile).** `/app/waitlist` lets an owner or manager record
  an existing client’s eligible service, active location, optional eligible
  staff preference, date/time window, and internal note. Each entry is
  tenant-scoped and appears in waiting, offered, booked, cancelled, or all
  views; status transitions write immutable tenant audit events.
- It deliberately does not yet choose recipients for an opening, send a
  notification, reserve a slot, or convert an entry to a booking. Those are
  the next smart-waitlist capabilities and need an explicit offer/expiry
  contract rather than a silent booking shortcut.
- **Database-backed / build-verified:** Waiting and offered entries now resolve
  a currently eligible active staff member (preferring the recorded staff
  preference when still eligible) and provide a **Find a slot** handoff to the
  tenant Calendar. The Calendar receives the client, service, location and
  staff context, then performs its normal live availability checks before the
  operator may create a booking. This is deliberately not an automatic offer
  or status change.

### Control dashboard model

#### Fleet Command Centre

An attention-first queue for failed provisioning/migrations, stale backups,
booking errors, incomplete setup, no booking activity, capacity saturation and
future invitation expiry. Every signal must lead to an explicit action.

#### Tenant Health Matrix

One filterable operating table: business, 30-day bookings, active clients,
capacity, no-show rate, setup state, database health and next action. Use small
trends, not oversized charts.

#### Business lifecycle and platform reliability

- Lifecycle: business created → owner claimed → services → staff → availability
  → first booking → first returning client.
- Database and migration health, backup age, booking/hold/confirmation success,
  future outbox delivery health, authentication failures and immutable activity.

### Explicit non-goals for the next dashboard milestone

Do not begin payments/POS, marketplace, insurance billing, AI receptionist or
predictive scoring before the core operational widgets are real and verified.

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

The shared server-rendered navigation uses a centered black primary bar for Overview, enabled Calendar/Clients links, and Reports. A searchable Apps drawer holds Bookings plus the remaining enabled modules, grouped as Operations, Manage, and Tools. It uses relevant Lucide React icons (rather than placeholder glyphs); its dismissal layer remains visually transparent so the working screen stays visible behind the elevated drawer. A compact signed-in account trigger exposes the real identity and supported Staff workspace/monthly-target destinations, with sign-out; it deliberately does not advertise unsupported account, subscription, or support operations. The drawer and account menu are entitlement-aware: disabled modules are omitted from navigation and rejected server-side. Their open, close, desktop, and 390px mobile states were browser-verified locally for Nordic. Canonical dashboard paths use `/{business}/app/...`.

**Build-verified design-system pass.** Overview, Bookings, Calendar, Clients, Locations, Notifications, Reports, Resources, Services, Targets, Staff, and Waitlist now share a restrained monochrome operational language. The authenticated-page scope normalises legacy green/peach surfaces into neutral cards, filters, controls, tables, metrics, drawers, service lists, staff workspace panels, and responsive layouts; duplicate legacy page headers are suppressed in favour of the shared shell and each module's own content heading. A fresh end-to-end browser audit is currently blocked by local development control-database connection saturation (`too many clients`), so this visual pass is build-verified rather than newly browser-verified.

**Build-verified appearance preferences.** The signed-in account menu provides browser-local Light, Dark, and System colour modes plus an optional neutral, blue, violet, or rose control tint. The tint applies only to controls and active/focus treatment; booking, payment, and appointment-status meanings remain independent of it. Preferences persist across browser reloads and do not alter tenant records or another user's workspace.

## Locations

**Database-backed / build-verified / browser-verified (local Nordic).**

`/app/locations` is a tenant-scoped owner/manager setup path for fixed or
mobile locations, online-bookability, contact/address details, active state,
and weekly opening hours. Migration `0006_locations.sql` creates the location,
hours, staff-location, and service-location foundations and backfills one
primary location per tenant. Public availability, holds, and confirmations now
carry a validated location. The public booking flow defaults to the primary
online location and shows a customer location chooser when multiple online
locations exist. Calendar location selection scopes staff, services, confirmed
appointments, and live capacity; Bookings exposes the persisted location and
an all/location filter. Local Nordic browser verification covers the booking
flow, Calendar, and Bookings. Staff and Service drawers now expose active
location assignments; server actions validate selected tenant records before
persisting them. The assignment controls are browser-verified locally; a
separate multi-location persistence scenario remains to be added.

Configured weekly opening hours are enforced by the public availability engine
in the location's timezone. They are therefore a booking constraint, not only
a setup display. Location editors also manage dated closures; they remove all
public availability at that location on the selected local date. Migration
`0007_location_closed_dates.sql` is applied locally to Nordic and Copenhagen.

## Services

**Status: Database-backed / browser-verified.**

`/app/services` lists persisted tenant services and supplies a right-side add/edit panel. Owner/manager updates duration, price, buffers, optional recommended return cadence, active state, and eligible employees atomically. The 1–730-day cadence is used only for the tenant-local due-back/overdue signal in Reports and client history; it does not message customers or affect availability.

## Resources

**Database-backed / build-verified / browser-verified (local Nordic, desktop and
390px mobile).** `/app/resources` is feature-gated and lets owners/managers
create or edit a tenant-scoped room, chair, bay, equipment unit, or other
shared exclusive resource. Each record is one capacity unit, with a type, active state, active
location assignments, and service assignments; create/update activity is
audited. Migration `0011_resource_locations.sql` adds the explicit
resource-to-location relationship. When a service is assigned an active
Resource at the selected location, both manual and public booking allocate an
eligible resource and persist it on booking and block. Public slot generation
omits resource-conflicted times; the hold transaction rechecks allocation and
the PostgreSQL exclusion constraint remains final protection. Local Nordic
browser verification confirmed a public booking with a resource and showed an
occupied room/time was absent from availability. Rescheduling now excludes its
own block while rechecking and persisting an eligible resource in the same
conflict-protected transaction; local Nordic browser verification moved a
resource-backed public booking from Monday 09:00 to Tuesday 11:00.

## Notifications

**Database-backed / build-verified / browser-verified (local Nordic, desktop and
390px mobile).** `/app/notifications` is feature-gated and provides a
tenant-scoped read-only view of transactional booking-email outbox entries,
including message type, recipient, related booking, and queue state. It
filters All/Queued/Sent/Failed and intentionally withholds management tokens
and raw payloads. A provider is not configured locally, so queued is a truthful
state rather than an assertion of delivery. Public confirmations queue a
confirmation entry. Cancellation now atomically queues a cancellation entry
with its booking-status/block update; that new cancellation path is
build-verified but still needs a dedicated browser mutation proof.

## Clients

**Status: Database-backed / browser-verified.**

`/app/customers` lists tenant-scoped persisted customers, booking counts, and
booked value, with name/email/phone search. The list stays focused until an
owner/manager chooses **Add client** or selects any client-table cell: both
open the same modal, blank for creation or prefilled for the selected record.
The selected-record modal also retains contact context and persisted
service/staff/status history. Migration `0008` adds tenant-internal notes and
comma-separated tags; the modal renders both from the tenant database (local
Nordic browser-verified). The form save path writes and audits those fields,
but a dedicated browser persistence proof remains.
Nordic browser verification covers a public-booking client and an exact
service-cadence return recommendation. Recurrence/risk signals, read-only-role
testing, and Copenhagen verification remain.

## Staff

**Status: Database-backed / browser-verified.**

The former Team label is Staff. `/app/team` is a tenant-scoped staff workspace: a staff directory selects a focused profile, whose Details, Work hours, Services & locations, and Time off sections replace the former overloaded right-side drawer. Work hours is a day-by-day recurring weekly shift list, backed by one weekly RRULE per shift so each day can have separate persisted start/end times and multiple shifts. Each day opens an add/edit shift modal; cancelling discards its local draft and Save changes persists the edited rules. Owner/manager can persist contact data, role, staff code, job title, specialty/work type, free-text work location, internal notes, active state, service eligibility, active-location assignments, weekly hours, and time-off/availability exceptions. Time off uses an in-product calendar picker for one day or a bounded date range (up to 31 days); its full-day toggle blocks every selected date, while partial day reveals a dual-handle time range for the same daily interval. The start and end handles render independently, expose keyboard slider semantics, and visibly bound the selected interval; this control was build-verified and desktop browser-verified locally. Active status, service/location eligibility, day scheduling, and time-block state use compact toggle controls; service/location toggles remain independently selectable. The `0004_staff_profiles.sql` migration was applied to Nordic and Copenhagen. Local Nordic desktop and 390px mobile layout were browser-verified; dedicated persistence and Copenhagen verification remain.

The Work hours list uses the entire day row as its edit target, with a trailing pencil affordance rather than a repeated Edit button. It remains keyboard-operable and opens the same recurring-shift editor. The local Nordic fixture now has a persisted 09:00–17:00 Monday–Friday schedule for every active staff member (existing rules were preserved and only missing weekdays were added); the row interaction and modal were browser-verified locally. Overlapping intervals are blocked in the editor and independently rejected by the server before any availability rules are replaced; a new shift begins after the latest existing end time for that day.

Manager and owner profiles also expose a persisted Permissions tab. It provides compact toggles for appointment-status changes, own/team appointment management, team-calendar visibility, own/team time-off management, and waitlist management. Migration `0016_staff_permissions.sql` stores the settings in each tenant database and permission changes are audited. Calendar, time-off, and waitlist mutation actions enforce those settings server-side for an active staff member explicitly linked to their signed-in identity; unlinked staff identities are denied by default. Payments and client-record edits remain manager-only.

The permission matrix now also covers the existing operational modules that map to Mangomint's staff settings: client-record access and changes, business-report access, resource management, and service/location configuration. Migration `0017_staff_workspace_permissions.sql` persists these controls per tenant. Client and report access are denied without an explicit grant; resource, service, and location mutations are guarded server-side; and unavailable app-menu entries are hidden for the signed-in staff member. Sales, checkout/refunds, messaging, products, gift cards, packages, memberships, payroll, forms, campaigns, and flows are intentionally not presented as permissions because Waybook does not yet provide those modules. Tenant schemas that have not applied `0017` retain the first-cut permissions safely until their scheduled migration.

**Build-verified lifecycle and authorization tightening.** The profile action
menu provides owner-only temporary-password provisioning/reset and lifecycle
actions, while managers may only deactivate/reactivate non-owner staff. A
password reset invalidates the linked identity's active sessions. Deactivated
or missing staff profiles are rejected at tenant-workspace entry; non-manager
staff are constrained server-side to their own profile, calendar, and
appointments unless their saved permission explicitly grants team visibility.
Migration `0018_staff_lifecycle.sql` adds reversible archival. Until that
migration is deliberately applied to a tenant database, Archive is hidden so
the interface never claims an action succeeded when its schema is absent.

## Bookings and Calendars

### Bookings

**Status: Database-backed / build-verified / browser-verified (local Nordic).**

`/app/bookings` reads tenant-scoped bookings with actual customer, service,
persisted location, assigned employee, tenant-timezone start/end, status, and
source. Its combined all/location and allow-listed status filters are
browser-verified locally. Each assigned booking now opens its tenant-scoped
Calendar appointment drawer with the persisted location, staff member, and
week preserved; that includes cancelled records, which remain excluded from
the active schedule grid. Detail/history and status mutations remain.

### Calendars

**Status: Database-backed / browser-verified (Nordic).**

`/app/calendars` is Calendars-entitlement guarded and uses compact
location/staff/service selectors. It renders a tenant-timezone week grid of
confirmed bookings and merged bookable periods calculated with
`@thebookingkit/core`, scoped to the chosen location. Staff hours and
exceptions are managed in Staff details rather than Calendar.

The refreshed calendar layout defaults to a team Day board with compact
previous/current-date/next controls and location/staff/service context. Previous
and next retain the active scope and move the current Day or Week one period at
a time. Calendar
scope and view are intentionally one choice: **All staff** opens the team Day
board while choosing one staff member opens that person's Week view. Full-width
staff columns use the available desktop canvas and the pinned time rail has one
fixed label per hour. Each staff profile persists a calendar colour, selected
in the Details editor; its appointment cards use that colour in both the team
and individual views. Desktop has no horizontal calendar scrolling; only narrow mobile
screens retain horizontal panning to preserve readable time and staff columns.
Bookings and the pinned rail remain visually distinct in the
monochrome tenant shell: open bookable time is intentionally plain white grid
space, while only unavailable time carries the subtle diagonal hatch. Time
in an already elapsed tenant-local date remains visible as a quiet read-only
schedule state rather than being styled as an availability failure; calendar
creation and rescheduling never permit backdated starts. Time
labels are pinned exclusively to the first grid column and each half-hour cell
uses an explicit grid row, so dense booking cards cannot displace or vertically
drift the hourly rail. Team-day staff cells also have explicit staff-column and
time-row placement, so booking cards cannot move a cell's hidden staff identity
into an adjacent visible column. Drag/drop resolves the cell beneath the
pointer from that rendered staff/time identity; grid gaps are rejected rather
than guessed, and the server revalidates the exact destination before moving a
booking. Drag/drop targets are every free active-staff interval at the selected
location, based solely on conflicts with other held/confirmed appointments;
the public booking engine's service, working-hours, eligibility, and resource
filters are intentionally not imposed on this reception operation. The
Team Day's previous/next controls skip the selected location's configured
non-working weekdays, so they move from Friday to Monday rather than opening
an empty closed-day board; a direct closed-day URL remains available for
historical review. The
existing tenant-scoped actions and drawer flows are retained. Tenant work surfaces use the available desktop canvas
instead of a fixed narrow content column. This revision is build-verified and
the populated local Nordic team board was browser-verified with seven active
staff, including five explicit Calendar Review staff members with ten confirmed
local review bookings each on 10 November 2026.

Appointment drawer capabilities: customer edit, public-booking-style direct slot rescheduling, arrived/completed/no-show statuses, and Cancel (sets `cancelled`). A confirmed appointment exposes a direct header-level **Check in** action, while an arrived appointment exposes **Complete**, following the established calendar lifecycle without making reception staff hunt through the editor. A completed appointment remains visible for its history but has no Reschedule or Cancel control; both actions also reject completed records on the server. Owner/manager mutations are tenant-scoped and audited; rescheduling revalidates availability plus PostgreSQL conflict protection. Save, Reschedule, and Update status start disabled and activate only for their own changed section. The picker has seven days and four slots per row. Calendar creation is a top-right New appointment action or a click on a calendar time cell; both open the same right-side panel with the selected time prefilled. It validates eligibility and current availability, snapshots the service price, writes the confirmed exclusion-protected block and booking, and records booking/audit events. Local Nordic browser verification created a future appointment, displayed it in the calendar with its availability shortened, showed its `tenant` source in Booking Operations, and verified panel prefill for a clicked 10:00 cell. Nordic browser verification also persisted `arrived` and a 09:00 → 15:00 reschedule. The header command is build-verified; Copenhagen and disabled-module checks remain.

**Database-backed / build-verified / browser-verified (local Nordic):**
Calendars also offers a team Day view modelled on established appointment
operations patterns: one pinned time rail, active-staff columns, compact
previous/today/next controls, and appointment cards that lead to the same
right-side drawer. The existing individual Week view remains the detailed
availability surface. The time rail uses explicit first-column and row
placement so appointment cards cannot shift its labels; desktop columns fill the available
canvas while the team board stays horizontally scrollable on 390px mobile.
Clicking an empty staff/time cell transfers that staff member and local time
into the same validated appointment form.

Time off and short operational blocks belong in the relevant Staff profile,
not as a duplicate dashboard workspace. The Staff drawer supports full-day or
exact timed unavailability through the shared `availability_overrides` model.

When a service is assigned an active Resource at the selected location, both
manual and public booking allocate an eligible resource and persist it on both
booking and block. Public slot generation omits resource-conflicted times;
the hold transaction rechecks allocation and the PostgreSQL exclusion
constraint remains final protection. Local Nordic browser verification
confirmed a public booking with a resource and showed an occupied room/time
was absent from availability. Rescheduling excludes its own block while
rechecking and persisting an eligible resource in the same conflict-protected
transaction; local Nordic browser verification moved a resource-backed booking
and retained its room.

**Tested / browser-verified (local Nordic):** calendar drag/drop first asks
the server for the dragged appointment's exact eligible destinations, then
tints only those cells. Non-target cells retain their normal available or
unavailable appearance—there is no blanket disabled/grey treatment. The
focused browser test performed a native drag to a server-approved staff/time,
received the success feedback, reloaded the team Day board, and confirmed the
same booking persisted. Desktop and 390px mobile calendar layouts were checked
afterward.

**Tested / browser-verified (local Nordic):** a calendar cell represents an
appointment start, not a hidden buffer. If a start's full duration would
overlap an existing booking, it is kept neutral and non-actionable instead of
using the unavailable hatch. The all-services board applies this rule as well,
so a half-hour immediately before a 60-minute booking no longer looks like a
blocked buffer; genuine staff, resource, and time-off unavailability remains
visibly blocked. Completed bookings now render a subdued card with a visible
Done marker.

Calendar owners/managers can also append an immutable card, cash, bank-transfer,
or other payment/refund entry from an appointment drawer. Local Nordic browser
verification recorded a card payment and Reports subsequently showed its paid
revenue separately from booked-service value.

## Public booking

**Status: Database-backed / tested / browser-verified (local).**

Tenant-first public booking is available at `/{business}/book`, resolves only through Control, preserves its tenant prefix for availability/hold/confirmation, and displays the server-assigned employee at review/confirmation. See [Booking engine](03_booking_engine.md) for the pooled availability contract and proof.

## Remaining module work

- External email-provider delivery, delivery webhooks, retries, templates, reminders, and cancellation messages. The tenant-visible outbox is available, but it deliberately does not claim queued messages were sent.
- Browser verification for Copenhagen and entitlement-denied routes/actions.
- Complete Bookings detail, filtering, history, and status behaviour.
- Repeat desktop/mobile acceptance for each production-ready module.
