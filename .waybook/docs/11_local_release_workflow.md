# Local-to-production workflow

Waybook's source code, databases and browser settings are separate. A successful deployment does not copy local changes, local demo bookings or browser appearance preferences to production.

## Before starting

1. Run `npm run waybook:release:check` from the designated checkout. It reports uncommitted files, compares local HEAD with GitHub main and the live Vercel commit, and checks which checkout owns port 3333. It requires GitHub network access, authenticated Vercel CLI access and `lsof`; an unavailable check is a failure, not a match. For an in-progress feature branch, a mismatch is expected until release.
2. Identify the active checkout and server (`git rev-parse --show-toplevel`, `git status --short --branch`, and the process listening on the development port). Use `/Users/amit/Documents/Waybook` as the designated checkout on this Mac; a task worktree based on current GitHub main is also acceptable. Preserve the older checkout until its remaining differences are reviewed.
3. Check the normal checkout and relevant worktrees for uncommitted changes and unpushed commits. Fetch GitHub `main`, compare its commit with the live Vercel deployment, and record differences. Review intended source changes; preserve them in coherent commits and push to an appropriate branch before beginning a new task. Reconcile overlapping work against current `main` with a three-way comparison. Preserve uncertain or unfinished work separately and report what still needs review. Never reset or discard user work, and do not blindly stage or push generated caches, credentials or local databases.
4. For a new task, start a branch from current GitHub `main` without the `codex/` prefix. When continuing an existing task, reuse its appropriate existing branch. Never push directly to `main`; use the review and release steps below.

The prior Lab was reconciled and retained as [`archive/lab-reconciled-20261121`](https://github.com/UserXpert/waybook/tree/archive/lab-reconciled-20261121) for [#52](https://github.com/UserXpert/waybook/issues/52). The tag records which changes matched released work and what remains available for reference. Next.js generates the app's `next-env.d.ts` for the running dev or build directory. Git ignores that generated file so starting the local server does not dirty the release checkout.

## Changes and review

1. Implement a bounded change, update its GitHub issue and record migrations, environment changes and data effects separately.
2. Run the relevant build and tests; verify UI changes on desktop and mobile against an isolated test database. Confirm that local-only changes are committed before claiming they are included.
3. Push the branch and open a pull request. Require the package, Postgres integration, E2E and migration-history workflows. For a direct release also verify the Waybook app preview; for a batch, verify the combined release preview as described below. Identify unrelated project failures explicitly instead of treating them as app success.
4. Merge only the reviewed commit after checks pass. The main branch automatically triggers Vercel production deployment; group changes when practical and assess migrations and rollback before merging.

### Batch several PRs into one production release

The release collector runs every three hours on a best-effort schedule and
collects PRs marked `release-ready` into `release/ready` after their exact head
passes the four GitHub checks. Apply that label only after reviewing the PR.
Conflicts, changed heads, missing checks, draft PRs and forked branches are
skipped. See [the collector runbook](release_branch_collector.md) for setup,
combined validation, first-run limitations and the manual release gate.

For a manual batch, start a short-lived release branch from current GitHub
`main` (without a `codex/` prefix). Keep each task on its own branch and PR for
review. Retarget the PRs
selected for the batch to the release branch and merge them there only after
their applicable checks and review pass. Alternatively, integrate reviewed
commits into the release branch while retaining links to each source PR and its
exact reviewed commit. Resolve conflicts explicitly; do not include unfinished
or unreviewed work just to fill the batch.

Open one release PR from that branch to `main`. Describe the included PRs and
issues, schema and configuration changes, data effects, compatibility and
rollback. Run the required package, database integration, E2E and
migration-history checks on the combined commit and verify its Waybook preview.
Apply the hosted migration release gate below to any change that needs schema
updates. Merge the release PR only after the combined result passes review and
checks. The single merge to `main` triggers one production deployment; verify
the exact deployed commit and affected flows using the steps below, and close
issues only after their own acceptance criteria are met.

Branch pushes can still trigger separate Vercel **preview** builds. Batching
production merges does not remove preview build limits or turn a failed or
unavailable required preview into a pass. Do not disable automatic deployments,
branch protection, or required checks as a shortcut for a batch.

## After merge

1. Verify the deployment is READY, its production domain points to the expected Git commit, and essential read-only routes respond. Run an appropriate authenticated smoke test when available.
2. Verify the main-branch checks and update the GitHub issue with the commit, deployment and test evidence. Keep unfinished work open.
3. Bring the designated development checkout onto the released main commit only after preserving or reconciling every local change. Check `git status` and the running server's working directory again.
4. Do not assume separate production and local databases contain the same bookings or staff. Seed or migrate data only through a separately reviewed, explicitly targeted process.

## Database schema

`npm run waybook:db:status -- --local` checks the three local schema histories without changing data. `npm run waybook:dev` checks for unknown migration records and applies pending versioned migrations to the three explicitly local databases before starting the app; it refuses unknown records and configured Waybook database URLs and does not seed data or start PostgreSQL. Back up valuable local data before schema changes.

Production schema changes still require versioned migrations: data and constraints do not update themselves. Do not run schema changes during Vercel builds or application startup. Before automating hosted changes, establish independent backups and retention, rehearse on isolated copies, verify compatibility and recovery, and ensure deployment cannot advance on a failed migration. `npm run waybook:db:status` checks explicitly configured targets read-only, but migration history alone does not prove physical schema integrity. The PR schema guard rejects modifications to previously committed SQL migration files. Waybook policy requires pull requests and the package, database integration, E2E and migration-history checks. Do not assume GitHub is enforcing those requirements: protection availability depends on the repository plan and visibility. Verify the current settings before release; if the protection API is unavailable, report enforcement as unverified and apply the review and check gates manually. Never bypass a failed check or force-push the release branch.

The PostgreSQL integration check exercises the Waybook SQL in `database/waybook/migrations` on disposable databases. It verifies fresh installation, preserved history on upgrade, rollback and retry, and concurrent application. Migration records continue to use the original filenames.

### Hosted migration release gate

The following is a manual gate, not an automated deployment safeguard. A merge to `main` deploys the app automatically and does **not** run or wait for a migration. Do not merge application code that requires a new schema until the compatible schema is already applied and verified across every affected database.

1. Identify the exact commit, migration files and every affected Control and tenant database. Record the existing deployment, current migration histories, expected schema changes, and a named release operator. Do not print connection strings, credentials or customer data in tickets or logs.
2. Verify a recent recoverable independent backup and its retention for all affected databases; create a fresh pre-change recovery point. If backup or recovery evidence is unavailable, stop. A Neon branch is useful for rehearsal but is not an independent backup.
3. Restore an isolated copy with no route to production writes, email or payment providers. Rehearse the exact migrations there, verify migration records and the actual changed tables, constraints and indexes, and exercise affected app workflows. Record results and rollback compatibility.
4. Use an expand-and-contract release: first deploy additive schema that works with the currently running app; deploy code that works with both old and new schema; remove old schema only in a later reviewed release. If the current app cannot operate safely during the transition, define a maintenance window and a tested recovery plan before proceeding.
5. Apply the reviewed migrations to explicitly identified hosted targets in a controlled maintenance operation. After each target, verify actual schema and history. A partial failure requires stopping the rollout, recording which targets changed, and assessing compatibility; never rerun blindly or assume multiple databases changed atomically.
6. Merge the dependent application change only after all target checks pass. Verify the exact production deployment and read-only authenticated workflows; monitor errors. If verification fails, stop further changes and roll the app back only to a version known to be compatible with the current schema. A code rollback does not undo data changes; restore databases only through the tested incident recovery procedure, accounting for writes since the backup.

Issue [#54](https://github.com/UserXpert/waybook/issues/54) tracks the release safeguards. [#8](https://github.com/UserXpert/waybook/issues/8) records the hosted recovery rehearsal and the deferred seven-day retention target. Unattended hosted migrations require verified independent backup, retention, and a fail-closed deployment gate.

## Evidence to record

For each release, record the local checkout and commit, pull request and checks, migration/schema status, production deployment commit and readiness, and the specific user-facing flows verified. State any checks that could not be completed. Do not conflate code, data or browser preferences. Update the tracking issue and leave it open while acceptance criteria remain unmet.
