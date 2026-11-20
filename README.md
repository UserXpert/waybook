<div align="center">
  <img src="apps/demo/public/brand/waybook-logo.svg" alt="Waybook" width="220" />

  ### More time for the people you serve.

  A simpler way from interest to appointment — for clinics and other service businesses.

  [Explore the website](https://waybook-website.vercel.app/) · [Documentation](docs/README.md) · [Delivery backlog](.waybook/docs/07_delivery_backlog.md) · [GitHub issues](https://github.com/UserXpert/waybook/issues)
</div>

---

## A calmer booking day

Waybook brings online booking, the calendar, staff and services together in one workspace. Customers can discover a service and choose an available time; businesses can see the resulting appointment alongside the rest of their day.

The first pilot is planned for Denmark, starting with clinics and appointment-based businesses. The aim is simple: make the small tasks around each appointment feel effortless, so teams have more time for their customers.

> **Status: in development.** Waybook has database-backed workflows and an isolated hosted preview, but is not yet cleared for a live clinic pilot. The [pilot readiness record](.waybook/docs/08_pilot_readiness.md) tracks the remaining release gates.

## From first click to next appointment

| Step | Experience | Current state |
| --- | --- | --- |
| **Share a booking page** | Give customers a route to a business's services and availability. | Tenant-specific public booking routes are implemented; branded booking and website embed work remains in progress. |
| **Choose a time** | Customers select a service and an available appointment. | Database-backed availability, temporary holds and booking confirmation are implemented and have focused test coverage. |
| **See the day clearly** | Teams manage appointments, people, services and locations from a shared workspace. | Calendar and management workflows are implemented; see the [module ledger](.waybook/docs/04_modules_ledger.md) for feature-level evidence and gaps. |
| **Keep customers informed** | Confirmations and reminders help customers know when and where to arrive. | Email delivery is not yet verified for the pilot. Businesses will use a manual confirmation process for now. |

The website also describes future possibilities such as SMS, integrations and additional industry-specific flows. These are product directions, not a promise that they are available today.

## Built for appointment operations

- **One workspace per business** — tenant-scoped routes and operational data, with a central Control database for tenant and identity records.
- **A calendar connected to real availability** — staff schedules, location hours, booking holds and database-level conflict protection.
- **The people and services behind each booking** — customer, staff, service and location management connected to the booking workflow.
- **Commerce foundations** — selected product, package and gift-card workflows; see the [commerce ledger](.waybook/docs/05_commerce_foundation.md) for scope and verification.

Waybook is an operations product, not an electronic health record. Diagnoses, treatment notes, prescriptions and clinical images are outside its intended scope. Appointment or service information can still reveal health information, so the [Denmark privacy review](.waybook/docs/10_denmark_privacy_review.md) remains a release requirement.

## Developer onboarding

Waybook uses a protected GitHub `main` branch and Vercel production deployment. Local files, the deployed code, database contents and browser appearance settings are separate; a successful deployment does not automatically copy local changes or data.

### 1. Choose the right checkout

Clone [UserXpert/waybook](https://github.com/UserXpert/waybook). On the current development Mac, `/Users/amit/Documents/Waybook` is the designated local checkout; an isolated task worktree based on the latest `main` is also suitable. Preserve work in older checkouts and never reset or discard changes without first reconciling them.

```sh
git rev-parse --show-toplevel
git status --short --branch
git remote -v
```

After setup and once the local server is running, run `npm run waybook:release:check`. The release check compares the checkout and its working tree with GitHub `main`, the commit serving the production domain, and the checkout running on local port 3333. It needs network access, an authenticated Vercel CLI and `lsof`. An unavailable check is not proof of parity; a task branch is expected to differ from `main` until its changes are released.

### 2. Set up an isolated local environment

**Requirements:** Node.js 22.12 or later, npm and PostgreSQL tools (`initdb`, `pg_ctl`, `createdb` and `psql`). CI uses Node 24. The local database script uses `127.0.0.1:5440` and creates separate Control, Nordic Studio and Copenhagen Physio databases.

If port 5440 is occupied, choose an unused local port for this checkout and set `export WAYBOOK_POSTGRES_PORT=5549` in the same shell before running the commands below. This setting applies to the database, migration, seed and application commands. Verify the port is free first; never point a disposable setup at an existing database.

The database cluster belongs to this checkout; stop it before changing its port. If application port 3333 is also occupied, replace the final `waybook:dev` command with `npm run waybook:db:status -- --local`, then `npm run waybook:db:migrate -- --local`, followed by `./node_modules/.bin/next dev apps/demo --port 3359`. Open `localhost:3359/login` instead.

For a **new, disposable** local database only:

```sh
npm ci
npm run waybook:db:start
npm run waybook:db:migrate -- --local
env -u WAYBOOK_CONTROL_DATABASE_URL -u WAYBOOK_NORDIC_STUDIO_DATABASE_URL -u WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL npm run waybook:db:seed
npm run waybook:dev
```

Open [localhost:3333/login](http://localhost:3333/login). Connection examples are in [`.env.waybook.local.example`](.env.waybook.local.example). The seed command writes demo users and data; the example unsets the three configured database URLs for that command so it targets the local defaults. For a fresh seed, sign in as `owner@nordic.local` with the local-only default password `waybook-local-only`, unless `WAYBOOK_LOCAL_PASSWORD` was set when seeding. Do not use seed credentials in hosted environments.

For an **existing** database, preserve its data and check its history first:

```sh
npm run waybook:db:status -- --local
```

`npm run waybook:dev` checks the three local histories, applies known pending migrations and starts the app; it does not start PostgreSQL or seed data. It refuses configured Waybook database URLs, missing history and unknown migration records. Back up valuable data before schema changes. On the current development Mac, the historical tenant records were reconciled after a backup and restore rehearsal; their original names and timestamps remain in each tenant database’s `waybook_local_migration_history_archive`. If another database reports unknown records, investigate and back it up rather than bypassing the check; see [issue #54](https://github.com/UserXpert/waybook/issues/54).

### 3. Build and verify your change

Create a task branch from current `main`, identify the relevant GitHub issue and preserve any existing uncommitted work. Run the checks relevant to the change, for example:

```sh
npm run waybook:build
npm test --workspace=@waybook/app
```

Use the [GitHub workflows](.github/workflows/) for package, Postgres integration and browser-test setup. Verify affected user-facing flows on desktop and mobile using isolated test data. A local build alone does not establish hosted or pilot readiness.

### 4. Review, merge and verify production

1. Commit the intended files, push the task branch and open a pull request. Record schema, configuration and data effects separately.
2. Wait for the required package, database integration, E2E and migration-history checks. Check the Waybook app preview; track unrelated project failures separately.
3. Review migrations, compatibility and rollback before merging. **Merging to `main` automatically triggers a Vercel production deployment.**
4. Confirm Vercel is ready, the production domain serves the intended commit, and the affected user-facing flow works. Update the GitHub issue with evidence and leave it open if its acceptance criteria remain unmet.
5. Update the clean designated local checkout to the released commit and run `npm run waybook:release:check` again. Never overwrite unreconciled changes.

### Database changes and release safety

Database schema changes require versioned migrations; they must not be silently applied during Vercel builds or application startup. The schema guard rejects edits or deletions of existing migration files in pull requests. The history check reports recorded filenames, not a full physical-schema audit. Before hosted schema writes, verify the target, independent backup and recovery, rehearse on isolated copies, and plan a compatible rollout. Automated production schema changes are not yet enabled.

For the full checklist, see the [local-to-production workflow](.waybook/docs/11_local_release_workflow.md), [pilot readiness record](.waybook/docs/08_pilot_readiness.md) and [GitHub issue #54](https://github.com/UserXpert/waybook/issues/54).

## Inside the repository

```text
apps/demo/                       Waybook application and public booking routes
apps/demo/src/lib/waybook/       Booking, identity and operations logic
database/waybook/                Versioned Control and tenant migrations and runner
.waybook/docs/                   Architecture, decisions and delivery evidence
scripts/                         Local setup, migrations and focused verification
```

The application uses Next.js, React, TypeScript and PostgreSQL. Workspace packages use the `@waybook` scope. Other inherited branding and documentation are tracked in the [repository identity cleanup](https://github.com/UserXpert/waybook/issues/45).

## Documentation

Use the [documentation index](docs/README.md) to find architecture, booking, release, support and privacy guidance. The [manifest](.waybook/docs/00_manifest.md) routes implementation work to the authoritative topic documents. The [local-to-production workflow](.waybook/docs/11_local_release_workflow.md) is required before reconciling changes or deploying. [Historical reference links](docs/archive/README.md) point to the earlier repository snapshot.

## License and attribution

Amit Das’s original contributions to Waybook are reserved; see [LICENSE](LICENSE). Waybook also contains inherited code subject to its own license, recorded in [third-party notices](THIRD_PARTY_NOTICES.md). That notice applies to the inherited material, not to Waybook as a whole. The scope of inherited code is being reviewed in [issue #60](https://github.com/UserXpert/waybook/issues/60).
