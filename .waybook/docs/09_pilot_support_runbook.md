# Pilot support runbook — draft

This runbook supports a small, manually onboarded pilot after the release gates in `08_pilot_readiness.md` are met. It is not evidence that hosted backups, alerting, or automatic email delivery are configured.

## Start of day

1. Sign in to the business's explicit `/{tenant}/app` route. Confirm the business name and location before inspecting any client or appointment.
2. Open the calendar for each active location, check the current date and staff filters, and review pending booking changes and overdue arrived appointments.
3. Until email delivery is verified, review the booking list and contact customers manually through the business's existing approved channel where necessary. Queued outbox records are not delivered emails.

## Manual booking messages

Before accepting pilot bookings, the business owner records the primary operator, backup, approved customer channel, contact verification procedure, coverage hours, and message timing. Review new and changed bookings at opening and before handoff. For staff-made changes, send the update after verifying the saved appointment. For online changes, send it when spotted within the business's agreed response window. Escalate any same-day change that the scheduled review would catch too late.

1. Open **Bookings** in the correct workspace and locate the booking by its reference. Verify the current status, location and date/time in the business's timezone. Ask customers to keep the reference displayed after online booking.
2. Confirm the recipient through the agreed channel. Send only the booking reference, business location, appointment time and relevant change. Keep clinical or service details out of the message.
3. Record the reference, event, operator, time, channel and outcome in the business's approved handoff record. Check the last recorded event before sending again. If the send fails, record it as pending and hand it to the backup operator. The Waybook Emails screen shows queued records. Use the handoff record to track manual sends.

**Confirmation**

Your booking [reference] is confirmed for [local date and time, timezone] at [location].

**Reschedule**

Your booking [reference] has moved to [new local date and time, timezone] at [location]. This replaces your previous appointment time.

**Cancellation**

Your booking [reference] for [last scheduled local date and time, timezone] at [location] has been cancelled.

### Rehearsal and sign-off

Use one synthetic booking and separate operator and test-customer sessions. Create it, move it, then cancel it. At each step compare the customer view, the operator's Bookings row and the message received. Check that the reference stays the same, the change quotes the new time, and the cancellation is still visible after reloading. Record the environment, operator role, channel, elapsed time and outcome for each step. Confirm the business's agreed channel, primary and backup coverage, and response window before marking the gate complete.

On 24 November 2026, Codex acted as the operator in Nordic Studio on a local Waybook server at `804e4a9`, using disposable databases and a file-based test inbox. At 1440px and 390px, the operator found each synthetic booking by reference. The test inbox captured one confirmation, one message with the updated time, and one cancellation per layout. The cancelled status persisted after reload. A second check sent the six resulting messages to a disposable inbox over local SMTP. All subjects and message bodies matched on receipt, and the test server rejected a different recipient. The business still needs to agree its actual channel, timing and staffing and exercise the workflow through that channel. [Issue #14](https://github.com/UserXpert/waybook/issues/14)

## Booking reports

1. Ask the business for its workspace, location, approximate local date and time, and booking number. Avoid copying customer contact details into general logs or chat.
2. Check the booking list and appointment drawer, including status, location, assigned staff, and local time. Compare with the correct calendar day and filters.
3. For missing availability, check the location's active and online state, service visibility and location assignment, staff assignment and working hours, location hours and closures, existing bookings and holds, and timezone. Do not manually override a conflict.
4. For cancellation or rescheduling problems, check the current booking status and policy. Bookings with financial activity may require staff handling; do not make an unverified payment or refund adjustment.
5. If the issue persists, capture the time, tenant route, booking number and non-sensitive error message. Escalate privately with the minimum necessary context. Do not expose credentials, full client records or raw database connection strings.

## Incident response

- **Wrong workspace data or suspected access leak:** stop the affected workflow and pilot onboarding, preserve relevant logs securely, and escalate immediately. Do not use another tenant's data for testing. Review the access boundary and incident impact before resuming.
- **Potential personal-data breach:** record discovery time, affected systems and known facts securely; notify the responsible incident lead and the affected controller promptly under the agreed contract. The controller must assess notification to Datatilsynet without undue delay and, where feasible, within 72 hours unless the breach is unlikely to risk people's rights and freedoms. Assess whether affected people must also be informed. The responsible contacts, contractual deadlines and exercise remain to be agreed before pilot. [Datatilsynet guidance](https://www.datatilsynet.dk/sikkerhedsbrud/anmeld-sikkerhedsbrud).
- **Bookings or availability unavailable:** record affected tenant, location and time; check deployment status, application logs and database reachability. Tell the business to use its agreed manual booking procedure until the system is verified.
- **Email queue grows or delivery fails:** confirm whether delivery is configured; do not mark messages as sent manually. Use the agreed manual communication procedure and escalate.
- **Migration or deployment failure:** stop additional changes; record deployment and migration status for Control and every affected tenant. A failed migration is transactional, but previously applied migrations remain. Do not assume a code rollback reverses database changes. Restore or repair only after identifying a verified backup and an isolated recovery plan.
- **Overdue booking job:** check recent Vercel logs for `overdue_booking_sweep_completed`, `overdue_booking_sweep_failed`, and `overdue_booking_sweep_limit_reached` after the local logging change is deployed. Missing summaries, failures, or the limit warning require investigation; the current daily job processes at most 1,000 overdue bookings per tenant. The endpoint must reject requests without the configured cron secret. The current Vercel plan's short log retention means older outcomes may no longer be available.
- **Suspected data loss:** preserve the source and relevant timestamps. Rehearse the [database restore](#database-recovery) in isolation before making a production recovery decision.

## Database recovery

1. Record the incident time, source databases, selected recovery point and an operator. Include Control and every affected tenant. Stop writes to the affected workflow when the incident requires it.
2. Restore to isolated destinations. For a Neon recovery point, use a separate restoration branch. For SQL archives, create empty destinations in a separate cluster and restore each custom-format archive with `pg_restore --exit-on-error --no-owner --no-privileges`. Verify database roles and grants independently before any hosted cutover.
3. Verify tenant identities, migration names and timestamps, and representative booking IDs, dates, statuses and locations. Start a production-mode build with only the restored database URLs and delivery disabled. Check Control sign-in and open a recovered appointment on its original date and location for each affected tenant.
4. Keep the source and recovery point intact until the operator reviews the results and decides how to handle writes made after the recovery point. Record scope, timestamp, outcome and remaining work without exposing customer data or credentials.

The [19 November hosted rehearsal](https://github.com/UserXpert/waybook/issues/8) used an isolated Neon restoration branch and verified recovered Control and both tenant databases. The operator opened a copied Nordic appointment. The [23 November synthetic rehearsal](https://github.com/UserXpert/waybook/issues/8#issuecomment-7084831940) used separate PostgreSQL 16 clusters at `cd6b335`. It preserved all three migration histories and their timestamps, and Chrome opened a recovered appointment in each tenant at desktop and mobile widths after the source cluster stopped.

### Current hosted retention

The owner deferred seven-day retention and closed [#8](https://github.com/UserXpert/waybook/issues/8) after the recovery drills passed. On 23 November the live Neon console showed six hours of point-in-time history, two retained recovery branches and no snapshot schedule. Manually retained branches provide discrete same-provider recovery points. [Live console evidence](https://github.com/UserXpert/waybook/issues/8#issuecomment-7085596098) · [Neon plan limits](https://neon.com/docs/introduction/plans#snapshots)

Before adopting a longer retention policy, record the provider's window and branch/storage capacity, cadence, maximum time between recoverable points, and the operator responsible for checking expiry and failures. The [hosted migration gate](11_local_release_workflow.md#hosted-migration-release-gate) independently requires verified backup evidence.

## Manual onboarding checklist — not yet a provisioning procedure

Record the business owner and approved tenant route, assign an operator and support contact, and verify a separate operational database and tenant membership. Apply and verify the current schema, configure timezone, currency, locations, services, staff and hours, then test a synthetic booking, reschedule and cancellation. Verify access from another tenant is denied and explain the email and other known limitations. Automated database provisioning, owner invitation, hosted restore and access checks remain incomplete; do not claim self-service signup or pilot readiness until the corresponding gates pass.
