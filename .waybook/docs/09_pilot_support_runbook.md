# Pilot support runbook — draft

This runbook supports a small, manually onboarded pilot after the release gates in `08_pilot_readiness.md` are met. It is not evidence that hosted backups, alerting, or automatic email delivery are configured.

## Start of day

1. Sign in to the business's explicit `/{tenant}/app` route. Confirm the business name and location before inspecting any client or appointment.
2. Open the calendar for each active location, check the current date and staff filters, and review pending booking changes and overdue arrived appointments.
3. Until email delivery is verified, review the booking list and contact customers manually through the business's existing approved channel where necessary. Queued outbox records are not delivered emails.

## Booking reports

1. Ask the business for its workspace, location, approximate local date and time, and booking number. Avoid copying customer contact details into general logs or chat.
2. Check the booking list and appointment drawer, including status, location, assigned staff, and local time. Compare with the correct calendar day and filters.
3. For missing availability, check the location's active and online state, service visibility and location assignment, staff assignment and working hours, location hours and closures, existing bookings and holds, and timezone. Do not manually override a conflict.
4. For cancellation or rescheduling problems, check the current booking status and policy. Bookings with financial activity may require staff handling; do not make an unverified payment or refund adjustment.
5. If the issue persists, capture the time, tenant route, booking number and non-sensitive error message. Escalate privately with the minimum necessary context. Do not expose credentials, full client records or raw database connection strings.

## Incident response

- **Wrong workspace data or suspected access leak:** stop the affected workflow and pilot onboarding, preserve relevant logs securely, and escalate immediately. Do not use another tenant's data for testing. Review the access boundary and incident impact before resuming.
- **Bookings or availability unavailable:** record affected tenant, location and time; check deployment status, application logs and database reachability. Tell the business to use its agreed manual booking procedure until the system is verified.
- **Email queue grows or delivery fails:** confirm whether delivery is configured; do not mark messages as sent manually. Use the agreed manual communication procedure and escalate.
- **Migration or deployment failure:** stop additional changes; record deployment and migration status for Control and every affected tenant. A failed migration is transactional, but previously applied migrations remain. Do not assume a code rollback reverses database changes. Restore or repair only after identifying a verified backup and an isolated recovery plan.
- **Overdue booking job:** check recent Vercel logs for `overdue_booking_sweep_completed`, `overdue_booking_sweep_failed`, and `overdue_booking_sweep_limit_reached` after the local logging change is deployed. Missing summaries, failures, or the limit warning require investigation; the current daily job processes at most 1,000 overdue bookings per tenant. The endpoint must reject requests without the configured cron secret. The current Vercel plan's short log retention means older outcomes may no longer be available.
- **Suspected data loss:** preserve the source and relevant timestamps. Restore a backup or point-in-time copy to an isolated destination first, verify tenant identity, schema and key records, and test the application before any production recovery decision. Hosted backup retention and the full hosted restore procedure still need verification.

## Manual onboarding checklist — not yet a provisioning procedure

Record the business owner and approved tenant route, assign an operator and support contact, and verify a separate operational database and tenant membership. Apply and verify the current schema, configure timezone, currency, locations, services, staff and hours, then test a synthetic booking, reschedule and cancellation. Verify access from another tenant is denied and explain the email and other known limitations. Automated database provisioning, owner invitation, hosted restore and access checks remain incomplete; do not claim self-service signup or pilot readiness until the corresponding gates pass.
