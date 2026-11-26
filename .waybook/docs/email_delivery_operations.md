# Email delivery operations

Booking email delivery is disabled unless `WAYBOOK_EMAIL_DELIVERY_ENABLED=true`. Each business must connect and verify its own Resend sender. A frequent, authenticated scheduler must call the email delivery endpoint; the endpoint uses `CRON_SECRET` as a bearer credential. Provider acceptance does not prove inbox delivery.

For a single-tenant rollout, set `WAYBOOK_EMAIL_DELIVERY_TENANT` to the workspace's database slug (`nordic-studio` for Nordic Studio). The booking trigger and scheduled worker both enforce this scope. Before enabling sends, verify the active sender and review queued messages dated after the active connection was created. These messages may be eligible when the worker starts.

The optional GitHub Actions sweep is scheduled every three hours and is inactive unless repository variable `WAYBOOK_EMAIL_SCHEDULER_ENABLED` is `true`; it also needs repository secret `WAYBOOK_EMAIL_CRON_SECRET` matching the deployment's `CRON_SECRET`. The workflow targets the production URL explicitly and runs only from the default branch. GitHub can delay or drop scheduled runs, so monitor queue age and use a more reliable scheduler before depending on precise reminder timing. Enabling the scheduler or email delivery is a deployment operation, not part of local development.

Provider credentials are encrypted with `WAYBOOK_PROVIDER_KEY_ID` and the 32-byte hex key in `WAYBOOK_PROVIDER_KEY_HEX`. To change the active encryption key, retain the former ID and key in `WAYBOOK_PROVIDER_PREVIOUS_KEY_ID` and `WAYBOOK_PROVIDER_PREVIOUS_KEY_HEX`, then set the new active pair. New connections use the active key; existing connections may still require the previous key. Invalid or conflicting key settings disable provider access.

Run `node --import tsx scripts/rotate-waybook-provider-keys.ts` for each tenant database with `WAYBOOK_ROTATION_DATABASE_URL`, `WAYBOOK_ROTATION_TENANT_ID`, and `WAYBOOK_ROTATION_CONFIRM=rotate` set in the process environment, alongside both key pairs. The operation is transactional per tenant and safe to rerun. Verify every tenant has been rotated and its sender still works before removing the previous key. Never put key values in source control, logs, support tickets or this document.

## Staff invitation email

Staff access approval sends a one-time password setup link from Waybook’s platform sender. Set `WAYBOOK_STAFF_INVITE_FROM` to an address on a verified Resend domain and set `WAYBOOK_STAFF_INVITE_RESEND_API_KEY` to a sending key for that domain. Set `WAYBOOK_STAFF_INVITE_ORIGIN` to the HTTPS Waybook app origin, and store a stable random secret of at least 32 characters as `WAYBOOK_STAFF_INVITE_SECRET`. Keep that secret stable while delivery retries are pending.

Apply Control migration 0006 and tenant migrations 0057–0059 through the hosted migration workflow before release. Staff invitation email has its own sender configuration and does not depend on the booking email flag or scheduler. Approval records provider acceptance, which does not establish inbox receipt. A retry from the owner review uses the same link and provider idempotency key within the supported retry window. Resending an accepted invitation creates a fresh link and invalidates the previous one. Deleting an outstanding request revokes its unclaimed invitation.
