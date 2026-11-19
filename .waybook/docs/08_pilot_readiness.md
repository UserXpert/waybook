# Small pilot readiness

Goal: support a small number of manually onboarded businesses with reliable day-to-day bookings. Self-service onboarding, broad provider configuration and new commerce features are outside this scope.

## Pilot decisions — 18 November 2026

The first clinic pilot is planned for Denmark. Scope the privacy, legal and
operations-only data-boundary review accordingly; professional review and the
remaining release gates still need evidence.

Use manual booking confirmation and cancellation communications for now.
The business must exercise the interim procedure below with its existing
approved communication channel before pilot. Automated email delivery is not a
prerequisite for this manual pilot workflow and must not be represented as live
until it is configured and verified.

The preceding booking reliability goal was reported merged and deployed in
PR #1, including hosted tenant indexes and a live calendar check. The historical
release notes below predate that completion; the broader pilot gates remain open.

## Current local release review — 18 November 2026

PR #1 is confirmed merged (merge commit `edebaff9d688ffd3f6825332706792d66fbb6782`).
The current mixed email/UI branch diverges from the released reliability branch
at `dd051cd`; many release changes also exist as uncommitted files here. A local
build is not evidence that this mixed tree can safely replace the deployed
release. Reconcile and review the combined changes on a release branch based on
current main, preserving the existing working tree, then rerun integration and
browser checks before deployment. Do not deploy this mixed tree as-is.

Staff photo permissions now explicitly deny read-only members and other staff
profiles, and the photo update and audit entry are transactional. Role-matrix
unit tests and the manager's profile-control rendering passed locally. An isolated browser test now verifies an oversized rejection and a successful
synthetic upload that persists after reload on desktop and mobile. Staff self-service, read-only UI denial, role-filtered Apps visibility and
role-appropriate sign-in were verified on desktop and mobile. A forged direct
server-action check and rollback on audit failure remain unverified. The tenant photo migration must be assessed on the target databases.

### Isolated release reconciliation evidence — 18 November 2026

The `codex/pilot-release-reconcile` worktree combines released `origin/main`
with the committed email branch plus the staff-photo and compact Apps changes.
The original mixed working tree is preserved. The combined work is committed locally for review (latest `372ee08`),
not pushed or deployed; remaining unrelated local changes have not been
ported or assessed. The release build and 37 app and 395 server unit tests pass.
Against disposable local databases, desktop and 390px mobile booking,
rescheduling, cancellation, tenant isolation, photo upload/oversize handling and
Apps menu checks passed. Separate desktop/mobile checks verified staff photo
self-service, read-only photo controls hidden, role-filtered menu items and
staff/read-only sign-in landing on Calendar. The email/booking integration also
passed with delivery disabled and a fake provider. These results do not establish
hosted email delivery, production database migration/rollback, or a full pilot
security and recovery review. The login landing fix is also in the original
working tree. Confirm releases and database targets independently before deploy.

## Pilot exit checklist

All five gates must pass. Record the deployment, date, operator and evidence for each; a local-only result does not establish hosted readiness.

1. **Release and access — open.** Review the local changes and required migrations, deploy the approved version, then verify that a business can access its own workspace and that another tenant and a read-only account cannot perform unauthorized writes. The current worktree includes tenant migrations 0049 and 0050 for booking lookup indexes; they have been tested locally only. Assess index creation locks and the hosted schema before applying them. The app's npm build rebuilds the shared core, database and server packages before Next; it no longer runs migrations. Apply required migrations explicitly using `npm run waybook:db:migrate` with verified target database credentials before deploying code that needs them. The worktree also contains dashboard, settings, email and typography changes requiring review. The hosted schema and deployment have not been verified for this release.

   User direction: finish roadmap item 1, then stop before starting item 2.

   Goal 1 review branch: `codex/booking-reliability-review`, draft PR
   https://github.com/UserXpert/waybook/pull/1. It was based on current main
   to avoid including the separate email-provider commits. Its production build,
   server and app unit tests, isolated migration rerun and synchronized
   eight-request booking race passed locally. The app's Vercel preview build
   succeeded. The configured tenant database variables target both production
   and preview, so the preview must not be treated as isolated. GitHub CI and
   hosted migration, access and booking checks remain release gates.
   A browser walkthrough against a disposable production-mode fixture created,
   rescheduled and cancelled a booking. It exposed a stale original confirmation
   after management; the review branch now clears it when that same booking is
   changed, and cancellation was rechecked in the browser. The initial GitHub
   browser workflow failed because `ubuntu-latest` resolved to unsupported 26.04;
   the review branch pins that workflow to 24.04 and its new run is pending.

   Local server-package suite: 395 tests passed on 2026-11-10. This does not
   replace a clean release build, review of the mixed worktree, or hosted checks.

   A fresh source copy with an offline dependency install successfully ran the
   complete npm app build against isolated databases; the generated server
   package includes deadlock retry handling. Vercel project inspection reports
   `apps/demo` as root. The latest existing production deployment's build log
   shows `turbo run build` and core/database package builds; it predates the
   current uncommitted changes and does not prove the new app prebuild or server
   package build ran. Confirm both in the eventual reviewed deployment log.
   The revised npm build was also verified with database connections unavailable;
   it succeeded without running migrations. Preview deployments still require
   isolated credentials for any application data access or explicit migrations.
   The migration command validates all three database URLs before connecting;
   local defaults require `npm run waybook:db:migrate -- --local` with no
   configured Waybook database URLs. Explicitly configured targets were verified
   against three isolated local databases, and missing, invalid and duplicate
   targets have local tests. Review the complete target list and backup before
   running it against hosted databases.
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
