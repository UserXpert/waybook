# Small pilot readiness

Goal: support a small number of manually onboarded businesses with reliable day-to-day bookings. Self-service onboarding, broad provider configuration and new commerce features are outside this scope.

## Pilot exit checklist

All five gates must pass. Record the deployment, date, operator and evidence for each; a local-only result does not establish hosted readiness.

1. **Release and access — open.** Review the changes and required migrations, deploy the approved version, then verify that a business can access its own workspace and that another tenant and a read-only account cannot perform unauthorized writes. This release adds tenant indexes 0049 and 0050 and changes the migration runner. On 2026-11-10, both indexes were applied to each hosted tenant database through Neon, with a transaction-scoped migration lock and five-second lock timeout; read-only follow-up queries confirmed both migration records and both indexes in each database. The procedure was rehearsed and rerun on an isolated local copy before the hosted change. The production build, unit tests, database integration checks and a disposable-data booking lifecycle passed locally; the hosted release is not yet verified. Preview and production share the configured tenant database variables, so preview booking actions can affect hosted data.
2. **Backup and recovery — open.** Agree a retention and backup arrangement suitable for the pilot, restore Control and tenant data to an isolated destination, start the application against it, and verify a recovered booking and calendar entry. Record the recovery steps and result without exposing credentials.
3. **Booking communication — open.** Demonstrate reliable confirmation and cancellation delivery, or explicitly agree and exercise a manual process with the pilot business. Customers and staff must know how booking references and changes will be communicated.
4. **Operations — open.** Verify hosted migration state, scheduled-job execution and failure visibility, designate an operator for checking failures, and exercise the support runbook for a booking problem and a recovery escalation.
5. **Hosted pilot walkthrough — open.** On desktop and mobile, use synthetic data across more than one location to book, find the appointment in the calendar, reschedule and cancel it, checking availability, time and status at each step. Document any remaining manual handling.

## Evidence and outstanding work

| Area | Status | Evidence / next action |
| --- | --- | --- |
| Public booking and management | In progress | A synthetic local booking was created, found by booking number and email, rescheduled, found again at its new time, and cancelled. Production-mode tests on disposable database copies verified policy agreement is required, a forced policy-audit failure rolls back the booking, retry creates one booking and one policy audit, and reusing a client's email does not overwrite the existing name or phone. A changed policy is rejected until the customer reviews the new one; a matching policy is confirmed and audited. Confirmation and verified embed-source audits commit with the booking. The management endpoint now checks the request host rather than the server bind address; after this change a production-mode test against a disposable copy verified credential isolation, rescheduling, occupied-slot rejection, the paid cancellation guard and idempotent cancellation. The rescheduled booking and its calendar block had matching times, and cancellation set both booking and block to cancelled. A production-mode, authenticated team-calendar response showed the moved booking at its new Copenhagen local time and excluded the cancelled booking. Hosted proxy behavior and visual browser verification of this lifecycle remain unverified. This does not establish hosted behavior or email delivery. |
| Location and service eligibility | In progress | Production-mode tests on disposable local database copies verified hidden and cross-tenant services are denied, an unassigned location returns no availability and cannot create a hold, and two simultaneous requests for a single staff member's slot yielded one 201 and one 409. A concurrent public hold and managed reschedule for the same staff slot also produced exactly one winner; a concurrent cancellation and reschedule left no overlapping active staff blocks. The earlier hidden-service failure was traced to a test fixture that stored the visibility array as a JSON string. Malformed configured visibility now fails closed. Verify multi-location selection in the browser and deployed behavior before pilot. |
| Date navigation and availability | In progress | Local desktop and 390px mobile browsers moved to the following week and displayed its availability. Older responses cannot overwrite a newer selection. The local public API rejected a past hold and a multi-year request; a valid request returned only future slots within its bounds. Verify delayed/out-of-order responses and real multi-location data. |
| Calendar accuracy | In progress | Verify creation, rescheduling, cancellation, date and staff against persisted bookings, including mobile and multiple locations. |
| Tenant isolation and permissions | **Pilot blocker** | A cross-host development rewrite dropped the tenant header, allowing the old single-membership fallback to return the wrong workspace. Tenant pages, server actions and APIs now fail closed without that header; dashboard selectors use explicit tenant URLs and legacy unscoped dashboard paths are unsupported. On 2026-11-10, production-mode local tests against disposable Control and tenant copies passed own-tenant and cross-tenant client API checks in both directions, unscoped and spoofed-header denials, and own-tenant access via both localhost and 127.0.0.1. A read-only local session received 200 for permitted Nordic client lookup, 403 for staff lookup and 404 for Copenhagen. Direct booking-status and customer-edit server-action tests left data unchanged for an unprivileged staff member and a read-only member with retained write grants; the manager's equivalent actions succeeded. A Nordic manager's attempted customer edit using a Copenhagen booking ID did not change the Copenhagen customer in a separate disposable copy. An isolated dev server bound to 127.0.0.1 still loses the header and denies valid requests; normal localhost development works. Inspection of the installed Next.js router shows it classifies rewrite destinations relative to the configured server hostname, so a different request hostname can be treated as an external rewrite; use the same hostname as the development server binding. Do not re-enable membership fallback to work around this. Verify on the actual target deployment and test other mutations and roles before pilot. Read-only memberships discard retained write grants; duplicate staff emails no longer overwrite existing profiles. |
| Backup and restore | In progress | On 2026-11-10, local PostgreSQL dumps of Nordic and Control restored into disposable local databases with matching key counts. The connected hosted Neon Free project's main branch has **six hours** of history retention. A separate point-in-time child branch `pilot-recovery-drill` was created from main at approximately 12:48 Asia/Kolkata on 2026-11-10; read-only queries found 50 Nordic bookings, 2 Control tenants and 44 Copenhagen migrations. The branch is configured to auto-delete on 2026-11-11 at 12:49 Asia/Kolkata. A subsequent local application recovery attempt reached its Neon endpoint but both the locally stored credential and the readable Vercel production connection credential were rejected (PostgreSQL 28P01); Vercel's tenant-specific production secrets are not returned by its CLI. The temporary environment file was removed and no production branch was changed. This proves a recent isolated branch can be queried in Neon, not a complete application restore or recovery beyond six hours. Obtain a working recovery-branch connection securely, establish an appropriate durable backup/retention policy and test full application recovery before pilot. |
| Migrations and recovery | In progress | Each SQL migration and its history entry are transactional. Concurrent local runners on a fresh disposable database applied all 44 tenant migrations once between them, and a retry applied none. A forced migration-history insert failure rolled back the first migration; after removing the fault, retry applied all 44. Transaction-scoped advisory locking coordinates runners even with transaction pooling. Verify hosted migration state and recovery instructions. |
| Monitoring and support | In progress | Draft operational and incident guidance is in `09_pilot_support_runbook.md`. Vercel rejected a 24-hour runtime-log query because the Hobby plan's retention is shorter; a 30-minute aggregate returned no records. This does not verify error alerting or job success. The local overdue-booking cron now logs a non-sensitive summary and failed tenant slugs, but this has not been deployed or observed in Vercel. In a production-mode test against disposable databases, an unauthorized cron request was denied; two authorized runs converted a past confirmed booking to no-show exactly once, left a completed booking unchanged, and retained a past arrived booking in Notifications. A manager could view that notification; read-only and unprivileged staff received 404 and no appointment details. It runs daily and caps work at 1,000 per tenant per run. Check deployed job visibility, backlog handling and alert ownership, and exercise the runbook before pilot. |
| Email | Pilot blocker | The outbox has no connected delivery worker; confirmations and cancellation messages are queued but not delivered. The public confirmation now tells customers to save their booking details. Select and verify a minimal delivery or manual confirmation workflow before pilot; templates and placeholder rendering are not connected. |
| Pilot desktop and mobile | In progress | On a local production-mode fixture with two locations, desktop search switched to the second location and showed its assigned service. At 390px, switching back showed only the first location's assigned service, and a synthetic booking was confirmed with its booking number. This is not a complete desktop/mobile lifecycle or a hosted check. |

## Interim booking communications

Until a delivery method has been configured and verified, tell pilot businesses that Waybook does not send confirmation or cancellation emails. The customer must save the booking number and appointment details displayed after booking. Staff should review new and changed appointments in the calendar or booking list, and manually communicate confirmation or changes through the business's existing approved channel when needed. The Emails screen is an outbox of queued records, not proof of delivery. Do not promise automatic reminders or email confirmations during onboarding. This is a temporary operating procedure, not a completed delivery integration.

## Release reconciliation — 18 November 2026

### GitHub tracking and isolated preview

The release review branch `codex/pilot-release-reconcile` is pushed. A separate
seeded Neon resource and branch-specific Vercel environment variables isolate
its preview database connections from the production defaults. Deployment
`782042e` is READY and its public booking route returned HTTP 200 with synthetic
preview content; the hosted desktop/mobile walkthrough remains open. The
production deployment and migrations were not changed. Earlier notes below
describing this branch as unpushed or its preview as sharing production
database variables are historical snapshots, not its current configuration.

The pilot work is tracked in GitHub epic `UserXpert/waybook#2` and its linked
task issues; other backlog areas have their own linked epics. A closed local
task does not by itself establish hosted pilot readiness.

On 18 November, isolated hosted preview commit `b278b3f` passed the synthetic
booking walkthrough on desktop and at 390px across two locations. Each booking
was created, found, rescheduled to the selected date and time, found in the
correct staff calendar, cancelled and removed from the calendar. Read-only
queries verified matching booking/block times and cancelled states. The
walkthrough found and fixed a stale reschedule-availability response race; a
deliberately out-of-order browser regression passed at both viewport sizes.
GitHub issue #10 is complete for this isolated preview walkthrough.

With the Vercel trusted-authentication header, JavaScript-enabled owner sign-in
produced a client-side Next.js flight-data error. The calendar walkthrough used
the synthetic owner's form with JavaScript disabled to establish a session,
then inspected the calendar with JavaScript enabled. Later, normal
JavaScript-enabled owner sign-in passed on desktop and mobile in Chrome
authenticated directly to Vercel. The trusted-header automation failure remains
open in #42; its exact cause is not established. A direct-to-workspace
redirect did not fix that failure and was reverted. Production release checks
remain open.

The first clinic pilot is planned for Denmark. Booking confirmations and
cancellations use the business's manual process until automatic delivery is
configured and verified. The process must still be exercised with a pilot.

This review branch combines released booking reliability with the email branch,
the compact Apps menu, and staff photo/profile fixes. A local production build,
37 app unit tests and 395 server tests passed. On disposable local databases,
desktop and mobile booking, rescheduling, cancellation, cross-tenant client
access, staff-photo upload and oversized-file rejection, Apps navigation,
role-specific menu visibility and staff/read-only sign-in landing were checked.
The email/booking integration passed with delivery disabled and a fake provider.
The staff-photo permission helper is unit-tested; direct forged server-action
and audit-rollback tests still need reliable end-to-end coverage.

Hosted tenant migration state, the 0045–0048 and 0051 migration plan and backup,
recovery, hosted permissions and booking walkthrough, and Danish privacy/legal
review remain release gates. No live sender or automatic email delivery has
been verified. Remaining work in the original mixed checkout has not all been
reconciled or reviewed. This branch is not yet approved for deployment.

An additional disposable-database check verified encrypted email connections,
tenant isolation, replacement/disconnect, queue claims, retry safeguards and
fake-provider worker behavior. This does not establish real email delivery.

### Hosted configuration recheck — 18 November 2026

A read-only Vercel inspection shows the latest production deployment is READY
at merged commit `edebaff9d688ffd3f6825332706792d66fbb6782`. The three Waybook
database URL entries target production, preview and development together.
Therefore, an automatically created branch preview must be treated as using
production credentials unless isolated, branch-specific database targets are
configured and independently verified. The review branch has not been pushed.
No environment values were retrieved or changed.

### Demo calendar batch — 18 November 2026

The configured hosted Nordic Studio database received 24 confirmed synthetic
appointments dated 18 November 2026 through 15 January 2027. Their booking
idempotency keys start `waybook-demo-calendar-20261118:`, their customer names
start `DEMO · Calendar client`, and their email addresses use `example.invalid`.
They are assigned only to existing `Demo ·` staff and four `Demo ·` locations.
A read-only verification counted 24 bookings, 24 synthetic customers, four
locations and zero associated outbox entries. They reserve demo staff slots and
contribute to operational reports; treat them as test data. The deployed app's
sensitive database URL cannot be read from Vercel, so this does not independently
prove the configured local URL and hosted deployment point to the same database.
The deployed calendar itself was not checked because it required sign-in.
