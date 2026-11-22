# Waybook repository guidance

Waybook is a Denmark-first, multi-tenant booking operations application. It is in development and is not yet cleared for a live clinic pilot. Appointment and service information can still reveal health information; clinical records are outside the core product scope.

## Start here

- [README](README.md) for setup and current product scope.
- [WAYBOOK_MVP.md](WAYBOOK_MVP.md) and [manifest](.waybook/docs/00_manifest.md) for product decisions.
- [Delivery backlog](.waybook/docs/07_delivery_backlog.md) and [pilot readiness](.waybook/docs/08_pilot_readiness.md) for current priorities and evidence.
- [AGENTS.md](AGENTS.md) for repository working rules and form-field typography.

## Code and verification

The Next.js app is in `apps/demo`. The app-owned availability, retry, and database connections live in `apps/demo/src/lib/waybook`. Migrations and their runner live in `database/waybook`. PostgreSQL constraints and server-side authorization are part of booking safety: preserve tenant boundaries, concurrency protections, and transactional audit records.

Run a clean install, the affected package tests, and `npm run waybook:build` as appropriate. Database integration and browser tests use isolated databases as configured by `.github/workflows`. Verify actual desktop and mobile user flows for UI changes. Never seed or migrate production from a local development command.
