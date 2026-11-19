# Local-to-production workflow

Waybook's source code, databases and browser settings are separate. A successful deployment does not copy local changes, local demo bookings or browser appearance preferences to production.

## Before starting

1. Run `npm run waybook:release:check` from the designated checkout. It reports uncommitted files, compares local HEAD with GitHub main and the live Vercel commit, and checks which checkout owns port 3333. It requires GitHub network access, authenticated Vercel CLI access and `lsof`; an unavailable check is a failure, not a match. For an in-progress feature branch, a mismatch is expected until release.
2. Identify the active checkout and server (`git rev-parse --show-toplevel`, `git status --short --branch`, and the process listening on the development port). Use `/Users/amit/Documents/Waybook` as the designated checkout on this Mac; a task worktree based on current GitHub main is also acceptable. Preserve the older checkout until its remaining differences are reviewed.
3. Fetch GitHub `main`, compare its commit with the live Vercel deployment, and record any uncommitted files or other checkouts. Preserve user work; do not reset or discard it.
4. Start a task branch from current `main`. Reconcile any intended changes from another checkout with a three-way merge and review overlapping production changes. Exclude generated caches, credentials and local databases.

## Changes and review

1. Implement a bounded change, update its GitHub issue and record migrations, environment changes and data effects separately.
2. Run the relevant build and tests; verify UI changes on desktop and mobile against an isolated test database. Confirm that local-only changes are committed before claiming they are included.
3. Push the branch and open a pull request. Require the package, Postgres integration and E2E workflows, plus the Waybook app preview. Identify unrelated project failures explicitly instead of treating them as app success.
4. Merge only the reviewed commit after checks pass. The main branch automatically triggers Vercel production deployment; group changes when practical and assess migrations and rollback before merging.

## After merge

1. Verify the deployment is READY, its production domain points to the expected Git commit, and essential read-only routes respond. Run an appropriate authenticated smoke test when available.
2. Verify the main-branch checks and update the GitHub issue with the commit, deployment and test evidence. Keep unfinished work open.
3. Bring the designated development checkout onto the released main commit only after preserving or reconciling every local change. Check `git status` and the running server's working directory again.
4. Do not assume separate production and local databases contain the same bookings or staff. Seed or migrate data only through a separately reviewed, explicitly targeted process.

## Database schema

`npm run waybook:db:status -- --local` checks the three local schema histories without changing data. `npm run waybook:dev` checks for unknown migration records and applies pending versioned migrations to the three explicitly local databases before starting the app; it refuses unknown records and configured Waybook database URLs and does not seed data or start PostgreSQL. Back up valuable local data before schema changes.

Production schema changes still require versioned migrations: data and constraints do not update themselves. Do not run schema changes during Vercel builds or application startup. Before automating hosted changes, establish independent backups and retention, rehearse on isolated copies, verify compatibility and recovery, and ensure deployment cannot advance on a failed migration. `npm run waybook:db:status` checks explicitly configured targets read-only, but migration history alone does not prove physical schema integrity. The PR schema guard rejects modifications to previously committed SQL migration files. GitHub main currently requires pull requests and the package, database integration, E2E and migration-history checks, with administrator enforcement and force pushes disabled. Verify protection remains enabled; repository settings can change.

## Evidence to record

For each release, record the local checkout and commit, pull request and checks, migration/schema status, production deployment commit and readiness, and the specific user-facing flows verified. State any checks that could not be completed. Do not conflate code, data or browser preferences. Update the tracking issue and leave it open while acceptance criteria remain unmet.
