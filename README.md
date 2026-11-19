# Waybook

Waybook is a multi-tenant appointment-operations application for clinics and other service businesses. It brings staff, services, locations, customers, availability and bookings into one workspace, with a public booking flow for each business.

The initial pilot is planned for Denmark. Waybook is an operations product, not an electronic health record: clinical notes, diagnoses, prescriptions and clinical images are outside its intended scope. Appointment and service information can still reveal health information and must be assessed as part of the pilot's privacy review.

## Current state

Waybook has database-backed tenant workspaces, staff and service management, location-aware calendars, public booking, booking holds and conflict protection, and selected commerce workflows. Parts have been tested and browser-verified; implementation and release status vary by feature. The [delivery backlog](.waybook/docs/07_delivery_backlog.md) and [pilot readiness record](.waybook/docs/08_pilot_readiness.md) are the authoritative sources for open work and verification evidence.

The application is not yet cleared for a live clinic pilot. Hosted backup and recovery, production migration readiness, permissions, monitoring, privacy and legal review remain release gates. Booking confirmations are handled manually until automatic delivery is configured and verified.

## Project layout

- `apps/demo` — the Waybook Next.js application, tenant workspace and public booking routes.
- `packages/db/src/waybook` — Control and tenant database clients and migrations.
- `apps/demo/src/lib/waybook` — tenant-aware booking, identity and operations logic.
- `.waybook/docs` — architecture, product decisions, delivery backlog and pilot evidence.
- `scripts` — local database, migration, seed and focused verification scripts.

Some shared packages retain their original names while the repository identity cleanup is in progress. They remain part of the build and must not be removed without verifying their callers and booking behavior.

## Local development

Requirements: Node.js 22.12 or later, npm, and PostgreSQL command-line tools (`initdb`, `pg_ctl`, `createdb` and `psql`). The local database script creates an isolated development cluster on `127.0.0.1:5440`; do not use client or production database connections for local seed data.

```sh
npm install
npm run waybook:db:start
npm run waybook:db:migrate -- --local
npm run waybook:db:seed
npm run dev --workspace=@waybook/app
```

Open [http://localhost:3333/login](http://localhost:3333/login). Local-only connection examples are in [`.env.waybook.local.example`](.env.waybook.local.example). The seed command uses configured database variables if present, so check the environment points exclusively to the intended local databases before running it. Local seed credentials are for development only and must never be used in a hosted environment.

For an application build and focused unit tests:

```sh
npm run waybook:build
npm test --workspace=@waybook/app
```

A successful build or unit test does not establish hosted readiness. Database-backed and browser tests require their own configured test environments; consult the documentation below before running them.

## Documentation and tracking

Start with [WAYBOOK_MVP.md](WAYBOOK_MVP.md) and the [documentation manifest](.waybook/docs/00_manifest.md). The [pilot support runbook](.waybook/docs/09_pilot_support_runbook.md) and [Denmark privacy review](.waybook/docs/10_denmark_privacy_review.md) record open operational and legal decisions. Work is tracked in [GitHub issues](https://github.com/UserXpert/waybook/issues).

## License and attribution

See [LICENSE](LICENSE) for the applicable MIT copyright and permission notice for inherited code. Preserve third-party notices when modifying or distributing inherited components.
