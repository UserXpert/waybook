# Identity, access, invitations, and business provisioning

## Status

**Current local auth: Database-backed / browser-verified.**

**Google/Better Auth, invitations, and Create Business: Designed.** Do not represent onboarding as self-service until this document's definition of done is satisfied.

## Current implementation

- Local identities use password hashes and expiring, hash-stored sessions.
- Platform admin and tenant-owner routing work locally.
- `admin@waybook.local` is a platform administrator and therefore lands on `/control` after login.
- Tenant members land at `/{business}/app` through the root post-login route.
- Control remains the authority for identities, memberships, tenant lifecycle, and approved tenant connection references.

Other tenant-role UI and automated authorization coverage remain incomplete.

## Google / Better Auth rebuild

The current local password-only sign-in must be replaced or extended with Google-backed Better Auth while retaining the Control database as the authority. Do not import the separate `/Users/amit/Documents/Waybook` repository's static dashboard, schema, or pool wiring.

### OAuth configuration checkpoint — 2026-11-05

- Google OAuth is centralized on `waybook-booking.vercel.app`.
- Registered callbacks are the hosted callback and `localhost:3333` callback only; tenant hostnames are not registered individually.
- Google client ID/secret and Better Auth signing secret are stored in Vercel-scoped configuration.
- Better Auth packages are present, but application integration, migration, invitation claim, tests, and browser proof are still outstanding.

## Invitation-only workspace claiming

Required design:

1. Accept only verified provider identity data.
2. Validate a scoped, expiring invitation transactionally.
3. Create or activate the correct tenant membership exactly once.
4. Record the event in immutable Control audit history.
5. Resolve the approved tenant connection server-side after acceptance.

No temporary password may be created or exposed during business onboarding.

Required tests: acceptance, repeat acceptance, expiry, revocation, tenant isolation, role assignment, and browser checks for Nordic and Copenhagen.

## Create Business provisioning pipeline

The future Control **Create Business** form must automate all of the following:

1. Create the tenant registry record and initial owner membership.
2. Create a dedicated operational PostgreSQL database.
3. Run tenant migrations and record version/status.
4. Seed required tenant settings and owner workspace.
5. Register the approved database connection reference and route/domain.
6. Verify database health, write platform audit events, then mark active.

No manual code change, separate dashboard deployment, or per-tenant OAuth configuration may be required. Nordic Studio and Copenhagen Physio are currently manually seeded tenants.

## Provisioning definition of done

- Google sign-in and Better Auth session flow are live against Control data.
- Invitation claim is secure, idempotent, audited, and tested.
- Control form creates/suspends/reactivates/deletes businesses with the approved two-step confirmation and full Control/tenant data cleanup policy.
- Database provisioning/migration/health checks are automated and recorded.
- New business dashboard and booking paths work on the shared Waybook origin.
