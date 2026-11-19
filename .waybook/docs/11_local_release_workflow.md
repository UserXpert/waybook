# Local-to-production workflow

Waybook's source code, databases and browser settings are separate. A successful deployment does not copy local changes, local demo bookings or browser appearance preferences to production.

## Before starting

1. Identify the active checkout and server (`git rev-parse --show-toplevel`, `git status --short --branch`, and the process listening on the development port). Use one designated checkout for normal development.
2. Fetch GitHub `main`, compare its commit with the live Vercel deployment, and record any uncommitted files or other checkouts. Preserve user work; do not reset or discard it.
3. Start a task branch from current `main`. Reconcile any intended changes from another checkout with a three-way merge and review overlapping production changes. Exclude generated caches, credentials and local databases.

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
