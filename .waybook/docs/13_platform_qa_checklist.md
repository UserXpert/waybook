# Waybook platform QA checklist

Use this for the full platform pass after the major issues have been fixed and the candidate commit is frozen. The checklist is a test plan. Every case starts unrun and gets its own result for each applicable tenant, role and device.

Companion references: [booking rules](03_booking_engine.md), [module capabilities](04_modules_ledger.md), [commerce rules](05_commerce_foundation.md), [pilot gates](08_pilot_readiness.md), [support runbook](09_pilot_support_runbook.md), [operations-only data](10_denmark_privacy_review.md), and [release workflow](11_local_release_workflow.md).

## Run setup and sign-off

| Record before starting | Value |
| --- | --- |
| Candidate commit, PR and migrations | |
| Isolated Vercel deployment and database verification | |
| QA lead, testing dates and issue tracker | |
| Major issues included and deliberately deferred | |
| Enabled features, provider test modes and approved communication channel | |
| Production baseline commit and rollback target | |

- Run all writes, retries, races, owner/role changes, recovery drills and test-provider exercises on disposable or isolated systems with synthetic fixtures. Use the exact candidate on the hosted preview. Verify the Control and both tenant database targets against production before entering any test data. The production pass is an authenticated read-only smoke check.
- Run critical workflows on desktop Chrome at 1440px and mobile at 390px. Run the customer booking journey on iOS Safari and Android Chrome, or record the exact simulator and any device coverage still missing. Include desktop Safari for critical web journeys and keyboard-only navigation for menus, drawers and forms. Include light and dark in the visual sweep.
- Use Nordic Studio and Copenhagen Physio for critical writes, permissions, public booking and tenant-isolation checks. Use independent browser sessions for role and tenant comparisons. For standard layout and validation cases, cover the primary tenant and repeat where plan, data, language or settings differ.
- Use a **Pass**, **Fail**, **Blocked** or **N/A** result for each run. Record why any case is blocked or inapplicable. A feature marked **when enabled** enters the pass only after its implementation is included in the candidate. A missing or unusable feature that was promised for the release is a failure or blocker.
- **P0** blocks release or pilot sign-off. **P1** covers expected workflow quality and needs a fix or explicit deferral with owner and date. **P2** covers lower-risk visual and consistency checks. Expand tests for high-impact fixes where existing automation misses the reported path.
- For every editable form, use the shipped entry point, finish the save, check feedback, reload or reopen, and check the affected downstream view. Compare the intended before/after values. Test invalid input, cancel/discard, repeated submission and the role that should have read-only access.
- For finding evidence, record the case ID, exact commit, URL or route, tenant, role, device, time zone, synthetic fixture ID, steps, expected and actual result, and linked issue. Capture screenshots or traces with synthetic data only. Keep credentials, login links, raw secrets and personal records out of the report.

### Fixtures to prepare

| Fixture | Setup |
| --- | --- |
| Workspaces | Nordic and Copenhagen with distinguishable names, services, staff, colours, photos and terminology. Use a disabled module and one workspace with sparse data. |
| Accounts | A platform admin, an owner and manager per tenant, staff with and without selected grants, a read-only account, and a deactivated or archived example. Add a shared-identity member across two tenants where supported. |
| Staff roster | More than eight staff members, one owner profile, distinct roles, several location/service assignments, one inactive member, one without a photo and a shared-image comparison using different test photos. |
| Booking | Two locations with different opening hours, multiple services and durations, split shifts, a closure, a staff absence, an exclusive resource and a shared resource. Include past and future appointments and one available slot contested by two customers. |
| Client history | Distinct new and returning clients, similar names, shared contact variants where allowed, an empty record and synthetic legacy values in retired note fields. |
| Commerce | Manual payments and refunds, active/inactive products, named/unassigned gift cards, insufficient and expired balances, and a package with limited visits. Use synthetic funds or provider sandbox fixtures. |
| Outbox and dates | An approved test inbox or sink, delayed/rejected delivery fixtures, and dates before/after Copenhagen daylight-saving transitions and at a month boundary. |

Start with the browser suites in [Waybook E2E](../../apps/demo/e2e/waybook-tests). Record the test file and exact run when it covers a case. The owner-name case uses `owner-profile-name.spec.ts`. The booking, terminology, staff-photo, client-field, waitlist and gift-card suites provide additional regression evidence. Run the uncovered branches of each case manually and use recurring misses to select new automation.

## P0 · Sign-in, access and workspace boundaries

- [ ] **AUTH-01** Sign in as each tenant owner through the normal form. The expected tenant opens and the account menu identifies the current owner.
- [ ] **AUTH-02** Enter a wrong password and a blank required field. The page stays usable, the error is actionable, and the session remains signed out.
- [ ] **AUTH-03** Sign out, refresh an authenticated page and use Back. The previous workspace data is unavailable until signing in again.
- [ ] **AUTH-04** Open a valid deep link while signed out. After login, confirm the destination follows the app’s supported return flow and resolves only authorized tenant routes.
- [ ] **AUTH-05** With independent Nordic and Copenhagen sessions, open the other tenant’s standard workspace links. Access is denied cleanly and no other tenant content appears in navigation, search, forms or browser history restoration.
- [ ] **AUTH-06** Where an identity belongs to both tenants, move between them using the supported entry points. The active tenant, profile name, photos, labels, forms and data follow the selected workspace.
- [ ] **AUTH-07** Open the site with an expired or revoked session from a second browser. The session ends cleanly and the account can sign in again only if access remains active.
- [ ] **AUTH-08** Exercise owner-led staff access reset and revoke on a fixture. Verify the affected staff session stops working and other staff and the owner keep access.
- [ ] **AUTH-09** Disable a synthetic staff account while it has an open browser tab. The next protected action is denied and the record remains unchanged. Restore access and verify a normal sign-in works.
- [ ] **AUTH-10** Compare owner, manager, standard staff, explicitly granted staff and read-only access for each critical module. Menu items and actual page access must match the role and feature policy.
- [ ] **AUTH-11** Follow a disabled module’s normal link from old history or a shared bookmark. The module is unavailable, the workspace remains usable and sibling modules still work.
- [ ] **AUTH-12** Open a tenant from Control as platform admin. Data is scoped to that tenant and tenant mutation controls are unavailable.
- [ ] **AUTH-13** When Google invitations are enabled, verify intended-account claim, expired and cancelled invitations, repeated use, and wrong-account sign-in. Each result must match the invitation status and intended membership.
- [ ] **AUTH-14** When password recovery is enabled, use the test inbox to exercise a valid, expired and reused link. The valid flow produces the expected session lifecycle and leaves tenant access intact.

## P0 · Staff profile, names, photos and roles

- [ ] **STAFF-01** Owner opens Account → Edit profile. It selects their own Staff record even when another member is first in the directory or was viewed previously.
- [ ] **STAFF-02** Owner changes their name and saves. Confirm the profile heading, directory and account menu agree immediately and after reload and sign-in on another browser.
- [ ] **STAFF-03** Submit whitespace, a very long name and a valid name with accented characters. Invalid values produce inline feedback without losing usable input. The valid name remains readable in desktop and mobile layouts.
- [ ] **STAFF-04** After the owner rename, verify email, role, sign-in identity, active/bookable state, existing bookings, assignments and the other tenant’s owner name. Confirm the audit event identifies the correct actor and one changed field.
- [ ] **STAFF-05** View the owner record as manager and as another owner where supported. The workspace owner’s own name form is unavailable. Reopen Staff and verify normal permitted manager actions still work.
- [ ] **STAFF-06** Open three distinct staff profiles in succession, including one with no photo. Each profile has one photo control or placeholder for the selected person, including after Back, Forward and reload.
- [ ] **STAFF-07** Upload distinct images to synthetic staff in both tenants. Verify the selected Staff record and the applicable account menu update. Sign in from a fresh browser to verify server persistence.
- [ ] **STAFF-08** Switch tenants in the same browser after an owner upload. The other tenant shows its own photo or initials. Verify a second browser shows the same tenant-specific result.
- [ ] **STAFF-09** Replace and remove a photo, then try an unsupported or oversized image. Verify errors, the last persisted photo on failure, the placeholder on removal, and the correct audit entries.
- [ ] **STAFF-10** Compare photo controls for owners, managers, staff editing their own record and read-only members. Exercise permitted writes and confirm denied cases have no changed photo or audit event.
- [ ] **STAFF-11** Add a staff member normally. Confirm defaults, searchability, allowed roles, assigned locations and services, then reload and edit the permitted profile details.
- [ ] **STAFF-12** Try a duplicate staff email. The existing profile and membership retain their original details and a usable explanation appears.
- [ ] **STAFF-13** Deactivate, reactivate and, where supported, archive a disposable staff member. Confirm directory filtering, active sessions, booking eligibility and visibility of historic appointments.
- [ ] **STAFF-14** Verify a manager can edit permitted staff and cannot promote an account to owner or alter protected peer/owner access. Confirm the owner’s own login still works.
- [ ] **STAFF-15** Save a changed staff permission and check the effect in an already open staff session after the next navigation or action. Revoke it and repeat with both the control and the action unavailable.
- [ ] **STAFF-16** When custom roles are enabled, find Roles & permissions as the third item in Settings and start Add role from the right of the Staff Role label. Both entry points lead to the correct workspace flow.
- [ ] **STAFF-17** When custom roles are enabled, select built-in and custom roles in Settings. The selection governs the displayed role name, description and permissions. Built-in protections and owner-only management are enforced.
- [ ] **STAFF-18** When custom roles are enabled, create a view-only role using the toggles, assign a test member, reload, then grant and revoke individual capabilities. Confirm the member sees the correct controls without changing other roles.
- [ ] **STAFF-19** When custom roles are enabled, exercise duplicate names, blank names, cancelling creation and editing a role in use. Confirm assignments, capability changes and any removal restrictions follow the candidate policy.
- [ ] **STAFF-20** When unique calendar colours are enabled, add staff through the first eight default colours and beyond eight. Confirm every staff member in the tenant gets a distinct persisted colour and newly generated options remain usable after reload.
- [ ] **STAFF-21** When unique colours are enabled, try choosing an occupied colour and add two members in separate sessions. The saved colours remain distinct. The same colour may be used independently in another tenant.
- [ ] **STAFF-22** Check the chosen colour in the Staff picker and appointment cards, in light and dark. A selected swatch uses one visible ring and retains keyboard focus indication.

## P0 · Settings, terminology and operations-only data

- [ ] **SET-01** Open every Settings navigation item and Business setup link. The active section, Back behaviour and full detail panel agree with the selected link on desktop and mobile.
- [ ] **SET-02** Change Copenhagen to Patient/Practitioner while Nordic remains Client/Staff. Verify both choices persist independently and update public booking, manage booking, Staff, Clients and the workspace navigation.
- [ ] **SET-03** Change just one terminology option, reload and verify the other option stayed selected. Check the labels in search, calendar, booking details and booking preview where those terms appear.
- [ ] **SET-04** Check an ordinary staff or manager session for the owner-only terminology form. A non-owner can read applicable labels and cannot change the workspace preference.
- [ ] **SET-05** Verify light, dark and system modes, accent selection, and persistence through reload. Appearance applies to the current browser and preserves status colours and another browser’s preferences.
- [ ] **DATA-01** Inspect create and edit screens for Clients, Staff, Time off, Waitlist, payment/refund, Gift cards and Retail. Retired free-text fields stay absent while required operational workflows remain usable.
- [ ] **DATA-02** On isolated fixtures with existing historical note text, verify normal detail views, client search and checkout reports omit the retired values. Confirm the historical fixture remains stored by an authorized read-only database check.
- [ ] **DATA-03** Check automated form-validation coverage for retired inputs and verify the accepted fields still save. Confirm a rejected save leaves the synthetic record and audit state unchanged.
- [ ] **DATA-04** Verify supported workspace text such as service description, closure label and booking policy still saves and displays in the correct scope.
- [ ] **DATA-05** Before introducing real pilot clients, verify issue #13 decisions for privacy notices, processor terms, access, retention, export, deletion, incident response and recovery copies. Use synthetic records for the rehearsal.

## P0 · Locations, services, staff availability and resources

- [ ] **CFG-01** Create or edit a location’s name, address, visibility and supported opening hours. Verify persisted values and available slots on both its public and staff-facing surfaces.
- [ ] **CFG-02** Save split opening hours and a closed date. Check boundaries, gaps, zero-length and overlapping intervals, then verify reopening or removing the exception restores expected slots.
- [ ] **CFG-03** Edit a service’s duration, buffers, price and allowed locations/staff. Compare public availability and booking details before and after save. Historic appointments keep their intended historical information.
- [ ] **CFG-04** Change public visibility and deactivate a synthetic service. Public selection and availability respect the updated state, and historical appointments remain readable.
- [ ] **CFG-05** Edit a staff member’s locations and services. Check eligibility at the assigned location and the unavailable service/location combination after reload.
- [ ] **CFG-06** Save multiple shifts on one day, attempt an overlap and cancel an unsaved shift. Check calendar working boundaries and public slot availability.
- [ ] **CFG-07** Add full-day, partial-day and supported multi-day time off. Check boundary slots, no spill across locations/dates, and restored availability after removing the exception.
- [ ] **CFG-08** Test a no-staff day, an ineligible staff member, a fully booked day and edge slots near buffers and closing time. The app returns a useful empty state and offers only valid alternatives.
- [ ] **CFG-09** Assign and unassign an eligible resource after booking. Confirm the appointment, calendar badge and Resource Schedule display consistent assignment state.
- [ ] **CFG-10** Try overlapping exclusive resource assignments and a permitted shared-resource overlap. The exclusive conflict shows a usable message and leaves the existing assignment intact.
- [ ] **CFG-11** Reschedule and cancel bookings with resources. Confirm assignment retention, visible unassignment or release matches policy and no resource time remains blocked incorrectly.

## P0 · Public booking and appointment management

- [ ] **BOOK-01** Open each tenant’s canonical booking page on desktop and mobile. Verify branding, service list, currency, time zone and any displayed terms belong to that workspace.
- [ ] **BOOK-02** Book a service at the second location through the full customer journey. Confirm assigned staff is eligible, price/time/location agree at each step, and exactly one booking reference appears.
- [ ] **BOOK-03** Compare confirmation, staff calendar, booking list and client history for that exact reference. Verify status, time, duration, staff, location and source match.
- [ ] **BOOK-04** Submit required fields blank, invalid contact details and corrected values. The UI explains the issue and preserves valid earlier choices.
- [ ] **BOOK-05** Change selections rapidly and use Back before confirming. The displayed times match the latest selection and a previously selected stale slot cannot be confirmed.
- [ ] **BOOK-06** Hold the same eligible slot from two independent customer sessions. Confirm the expected winner and a helpful conflict or refreshed availability for the other session.
- [ ] **BOOK-07** Leave a held slot to expire and return after the expiry. The abandoned hold releases availability and the expired selection cannot create a booking.
- [ ] **BOOK-08** Double-click confirmation or refresh after a slow response. Verify the system produces one booking and a consistent final state through the supported retry flow.
- [ ] **BOOK-09** Open Manage booking with the correct reference and email. A mismatched reference or email gives a safe error and reveals no appointment information.
- [ ] **BOOK-10** Reschedule through Manage booking. The old slot reopens, the new slot blocks, and the calendar and booking list show the same persisted result after reload.
- [ ] **BOOK-11** Cancel an eligible booking and repeat the cancellation using the supported customer flow. Confirm one cancellation, released availability, and the expected history and notification state.
- [ ] **BOOK-12** Attempt customer cancellation inside the controlled window and on bookings with manual tender or package handling. The flow directs the customer to the correct next step without creating inconsistent records.
- [ ] **BOOK-13** Check both spring and autumn Copenhagen clock changes and a month boundary. Stored appointment time, calendar labels and customer-visible time agree, including when the browser is set to another time zone.
- [ ] **BOOK-14** When direct booking links and embeds are enabled, test the correct location/service preset, supported mobile host, close and focus return, normal-link fallback, allowed domain and unsupported embedding surface.
- [ ] **BOOK-15** When consent capture is enabled, verify the correct policy version and required acknowledgement are shown and recorded on the synthetic booking.

## P0 · Staff bookings, calendar and waitlist

- [ ] **CAL-01** Create a manual appointment by clicking an available calendar slot and by the normal booking entry point. Check auto-filled date, staff, service/location eligibility and the saved record.
- [ ] **CAL-02** Navigate Day, Week, Month, date picker and Today. Confirm filter persistence, week/date boundaries, and expected calendar state after opening and closing an appointment drawer.
- [ ] **CAL-03** Use location, staff, service and status filters where offered. Confirm the active filter text, matching results, count and reset behaviour.
- [ ] **CAL-04** Drag a desktop appointment to a valid time, then reopen it. Verify the persisted slot, location, staff and availability. Repeat the equivalent operation through the mobile drawer.
- [ ] **CAL-05** Try an unavailable or conflicting move and cancel a pending edit. Verify the original appointment and any resource assignment remain intact.
- [ ] **CAL-06** Use a real appointment reference from Bookings and open its Calendar drawer. The correct staff/location/week appears even when each list contains another appointment for the same client.
- [ ] **CAL-07** Exercise permitted confirm, check-in, complete and no-show transitions. Check timing rules for future/past appointments and compare badges, notifications and reports.
- [ ] **CAL-08** Exercise cancellation and allowed past-booking corrections. Confirm cancelled records remain discoverable in history while active calendar availability is released and invalid reopening is prevented.
- [ ] **CAL-09** Test staff with own-only, team-view and team-manage capabilities. Verify the visible appointment data, control availability and persisted result for allowed actions.
- [ ] **CAL-10** Refresh with a drawer open, use Back/Forward, and deep-link into a different appointment. Confirm no stale detail or unsaved input follows the next appointment.
- [ ] **WAIT-01** Add an eligible waitlist entry and verify service, location, preferred dates and contact linkage persist. Try invalid ranges and confirm clear feedback.
- [ ] **WAIT-02** Find and update a waitlist entry, move it through supported statuses, and use the approved booking handoff where available. Confirm history and no unintended duplicate booking.
- [ ] **WAIT-03** Compare owner, delegated staff and read-only waitlist access. Verify the retained note fixture stays hidden and entries cannot follow the user into a different tenant.

## P0 · Payments, refunds, gift cards and package balances

- [ ] **PAY-01** Record a supported manual appointment payment. Verify balance, tender, timestamp, sale detail, customer history and reports reflect the same amount.
- [ ] **PAY-02** Test blank, zero, excessive and duplicate payment submissions. Failed attempts leave the prior balance and sale history unchanged.
- [ ] **PAY-03** Record a permitted partial and full refund. Verify the original payment remains in history, refund totals stay capped and net revenue updates.
- [ ] **PAY-04** Verify staff without checkout authority cannot record or refund payment from Bookings, Calendar or Sales.
- [ ] **PAY-05** Create a retail draft, add eligible product lines and close with supported test tender. Verify total, quantity, sale status and immutable line snapshots.
- [ ] **PAY-06** Reopen a closed retail sale and try ordinary re-submit or edit controls. The completed charge and line history stay intact and duplicate tender is prevented.
- [ ] **PAY-07** Update or deactivate a catalogued item after a sale. New use follows its active status and historical sales retain original item details, price and quantity.
- [ ] **GIFT-01** Issue named and unassigned test gift cards. Check duplicate issuance, expected display masking and derived balance after reload.
- [ ] **GIFT-02** Redeem a valid gift card in appointment checkout. Verify card ledger, appointment payment, sale and reports agree on debit and remaining amount.
- [ ] **GIFT-03** Test wrong customer, wrong workspace, insufficient balance, expired card, unsupported currency and conflicting tender combinations. The app shows an actionable error without changing balances.
- [ ] **GIFT-04** Cancel an eligible gift-card booking. The same card receives the correct refund and repeated cancellation produces no extra credit. Check the configured treatment of expired or voided cards.
- [ ] **GIFT-05** Attempt competing redemptions of a limited balance. Verify successful charges stay within funds and every successful debit has matching financial records.
- [ ] **PACK-01** Define a package with a supported service, visit count and expiry, then issue it to a client. Confirm one initial grant and matching client/service balances.
- [ ] **PACK-02** Test mismatched service, expired package and exhausted balance in all enabled redemption entry points. Verify visit and appointment records remain consistent.
- [ ] **PACK-03** When appointment package redemption is enabled, use one visit, reload and verify remaining balance. Exercise cancellation/refund policy, duplicate submission and exclusion of incompatible tender.
- [ ] **PAY-08** When an external processor is enabled, use its sandbox for successful and declined payment, retry, refund and webhook delay. Verify reconciliation with the provider and Waybook ledger without entering real card data.

## P1 · Clients, search, reporting and workspace navigation

- [ ] **CLIENT-01** Add a synthetic client, search by name and edit a permitted contact field. Confirm save feedback, reload persistence and correct use in the appointment picker.
- [ ] **CLIENT-02** Compare a new client, returning client, similar-name clients and an empty record. Search, paging and record links always select the intended person.
- [ ] **CLIENT-03** Open a client history, sales and booking links. All actions retain the selected person and tenant. Missing fields and empty histories have usable states.
- [ ] **CLIENT-04** Compare explicit view/edit grants and manager access. Read-only contacts remain readable when granted and edit actions remain unavailable.
- [ ] **NAV-01** Follow Overview, Calendar, Clients, Reports, Apps and Account links. The active menu item, page heading and browser navigation agree.
- [ ] **NAV-02** Find each enabled module with Apps search, including empty and no-result queries. Check keyboard navigation, Escape, outside dismissal and focus return.
- [ ] **NAV-03** Use global search for an exact synthetic booking and similar clients. Result labels and routes have the correct tenant, and restricted results stay hidden for limited staff.
- [ ] **NAV-04** Open and close multiple menus and drawers at 390px. Controls stay reachable, scroll remains in the right panel, and the page does not jump or overlay an active form unexpectedly.
- [ ] **REPORT-01** Reconcile a known mix of confirmed, completed, cancelled, no-show, paid and refunded appointments against Overview and Reports for the same date range.
- [ ] **REPORT-02** Compare location and staff views, a month boundary and a period with no activity. Totals follow the filters and currency/time display is consistent across reports.
- [ ] **REPORT-03** Change an authorized monthly target. Confirm saved values, aggregate calculations and empty-state display, then verify restricted roles cannot edit it.
- [ ] **REPORT-04** Confirm Notifications links open the intended overdue/review appointment and that limited staff see only the notifications granted by their role.

## P0 · Communications, Control and release operations

- [ ] **COMMS-01** Book, reschedule and cancel isolated fixtures. Check the expected outbox record, booking reference, tenant sender, subject and single event per action.
- [ ] **COMMS-02** In manual confirmation mode, exercise the agreed pilot channel with primary and backup coverage. Verify the customer UI makes the actual communication mode clear.
- [ ] **COMMS-03** When delivery is enabled, run approved test-inbox delivery, a temporary failure and a permanent failure. Confirm retries are bounded, statuses distinguish queued/sent/failed, and no duplicate customer message is sent.
- [ ] **COMMS-04** Verify a disabled or unverified sender produces the expected operational state. Confirm preview messages cannot go to real clients or production integrations.
- [ ] **OPS-01** Verify the deployed candidate commit, approved migration history and actual changed schema in Control and both tenants. Match the GitHub build, integration, E2E and migration-history evidence to the same head.
- [ ] **OPS-02** In Control, verify tenant status, feature/plan state, backup and migration visibility, and the canonical tenant workspace link. Check reversible suspend/reactivate on one isolated tenant and confirm another continues normally.
- [ ] **OPS-03** Rehearse a versioned migration against an isolated restore when schema changes are included. Verify old and new app compatibility, partial-failure handling and the rollback path.
- [ ] **OPS-04** Restore the independently recoverable backup of Control and both tenants. Sign in and recover a known booking, client and audit event from each restored tenant.
- [ ] **OPS-05** In isolation, exercise scheduled jobs for overdue bookings and any enabled delivery worker. Verify one expected state transition, safe repeated runs, failure visibility and named operator response.
- [ ] **OPS-06** Exercise the support runbook for a missing booking, a blocked release and a recovery escalation. Record who acts, what evidence they need and where the outcome is recorded.
- [ ] **OPS-07** Confirm the live domain points to the exact released deployment, then run read-only owner and public smoke checks across both tenants, including the affected screens. Review deployment errors in the available monitoring window.

## P1/P2 · Accessibility, responsive UI and resilience

Treat UI-06 as P2 when the issue is limited to visual alignment. Inaccessible controls, hidden actions, unusable focus and failed saves retain their workflow severity.

- [ ] **UI-01** Check public booking, Calendar, forms, Staff, Settings and checkout at 390px. Important controls, dialogs, errors and confirmation buttons fit or scroll inside their intended region.
- [ ] **UI-02** Repeat core pages in desktop and mobile light/dark themes. Verify text and state contrast, focus outline, active colours, photos and initial placeholders.
- [ ] **UI-03** Navigate primary menus, role toggles, date/time pickers, forms and dialogs by keyboard. Focus follows visible order, remains inside modal dialogs and returns to the opener on close.
- [ ] **UI-04** Check representative pages with a screen reader. Confirm headings, field names, validation, toggle state, save status, table headers and appointment details are announced clearly.
- [ ] **UI-05** Check text at 200% zoom, long staff and service names, long translations and empty data. Key controls remain readable and complete.
- [ ] **UI-06** Check circular buttons, avatars, swatches and icon-only actions in both themes. Visible content is centred and controls have accessible names and usable hit areas.
- [ ] **UI-07** Check loading, saving, empty, error, successful and disabled states. Feedback is visible in both themes and does not depend on colour alone.
- [ ] **UI-08** Test slow network, tab refresh while reading, and failure followed by a successful retry on an isolated save. Confirm useful feedback, retained input as appropriate and a single correct result.
- [ ] **UI-09** Verify core screens with a busy calendar, a long staff/client directory and many sales. Check navigation, filtering, scrolling and browser responsiveness during normal use.
- [ ] **UI-10** Run keyboard and mobile checks for destructive confirmations that are supported. The confirmation names the affected record, offers cancel, and leads to a clear outcome.

## Retest and sign-off record

| Case | Tenant / role / browser | Result | Evidence or issue | Fixed commit and retest |
| --- | --- | --- | --- | --- |
| | | | | |

- [ ] **EXIT-01** All applicable P0 cases have a recorded pass at the candidate commit. Any open or blocked P1/P2 item has an explicit owner, reason and target date.
- [ ] **EXIT-02** For every fix, retest the original steps and nearest related workflow on the same role and tenant. Re-run automated coverage where available.
- [ ] **EXIT-03** Keep the deploy ID, database readiness, exact CI checks, preview evidence, production smoke, monitoring results and any rollback notes together.
- [ ] **EXIT-04** Review privacy and operating gates before any real-data pilot, and log synthetic-fixture cleanup, remaining test-provider settings and who owns post-release monitoring.
