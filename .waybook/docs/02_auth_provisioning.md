# Identity, access, invitations, and business provisioning

## Status

**Current local auth: Database-backed / browser-verified.**

**Google/Better Auth and staff invitations: implemented on the #34 branch, pending release.** Create Business provisioning remains a separate item.

## Current implementation

- Local identities use password hashes and expiring, hash-stored sessions.
- The local sign-in page uses the Waybook brand and keeps the working password
  form. Its **Forgot password?** option truthfully directs staff to their
  workspace owner, who already owns the reset workflow. Google is available when
  OAuth configuration and the Control migration are present.
- Platform admin and tenant-owner routing work locally.
- `admin@waybook.local` is a platform administrator and therefore lands on `/control` after login.
- Tenant members land at `/{business}/app` through the root post-login route.
- Control remains the authority for identities, memberships, tenant lifecycle, and approved tenant connection references.

Tenant staff profiles can now be linked to a local identity by an owner using a
one-time temporary password. An owner can reset that password; resets revoke
the linked identity's active sessions. Deactivation is enforced when the staff
identity next enters the tenant workspace, rather than merely hiding a profile.
The controlled local login and authorization flow is build-verified; a new
staff-login browser run remains outstanding in this workspace because the
configured database host was unavailable during this pass.

Other tenant-role UI and automated authorization coverage remain incomplete.

## Google / Better Auth rebuild

Better Auth validates the Google OAuth response and issues a short-lived exchange session. Waybook consumes it once and issues the same revocable Control session used by password sign-in. Google provider tokens are discarded. Platform admin password access stays in Control.

### OAuth configuration checkpoint — 2026-11-05

- Google OAuth is centralized on `waybook-booking.vercel.app`.
- Registered callbacks are the hosted callback and `localhost:3333` callback only; tenant hostnames are not registered individually.
- Google client ID/secret and Better Auth signing secret are stored in Vercel-scoped configuration.
- Google accepted both registered callback URLs and returned its account-selection page during the 24 November configuration check. A real Google account completed the localhost flow against disposable data. An uninvited account was denied, and an invited account received read-only access to Nordic Studio and was denied entry to Copenhagen. The localhost OAuth client uses a separate Keychain-held secret. Hosted Google sign-in remains a release check.

## Invitation-only workspace claiming

An owner creates or revokes a 48-hour link from a staff profile’s **Google invitation** menu and shares the link through an approved channel. The link carries its secret in the URL fragment, and Control stores only its hash. Owners can link their own existing account. Claiming never creates an owner role. The Google subject is bound after the first verified, invited sign-in and can then be used at the normal login page.

Claim flow:

1. Accept only verified provider identity data.
2. Validate a scoped, expiring invitation transactionally.
3. Create or activate the correct tenant membership exactly once.
4. Record the event in immutable Control audit history.
5. Resolve the approved tenant connection server-side after acceptance.

Google invitations create no temporary password. Existing password accounts keep their existing access. A workspace owner can reset an existing password for a single-workspace identity. A tenant-issued password cannot gain access to another workspace through an invitation.

Desktop and mobile tests cover acceptance, repeat acceptance, expiry, revocation, role assignment, and tenant isolation in Nordic and Copenhagen using a synthetic provider. Production Control migration `0005` was restore-rehearsed against an encrypted backup and its six new tables were verified after application.

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
