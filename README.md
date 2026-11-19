<div align="center">
  <img src="apps/demo/public/brand/waybook-logo.svg" alt="Waybook" width="220" />

  ### More time for the people you serve.

  A simpler way from interest to appointment — for clinics and other service businesses.

  [Explore the website](https://waybook-website.vercel.app/) · [Product documentation](WAYBOOK_MVP.md) · [Delivery backlog](.waybook/docs/07_delivery_backlog.md) · [GitHub issues](https://github.com/UserXpert/waybook/issues)
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

## Getting started locally

**Requirements:** Node.js 22.12 or later, npm, and PostgreSQL command-line tools (`initdb`, `pg_ctl`, `createdb` and `psql`). The database script creates a local development cluster on `127.0.0.1:5440`.

```sh
npm install
npm run waybook:db:start
npm run waybook:db:migrate -- --local
npm run waybook:db:seed
npm run dev --workspace=@waybook/app
```

Open [localhost:3333/login](http://localhost:3333/login). Connection examples are in [`.env.waybook.local.example`](.env.waybook.local.example).

> The seed command uses configured database variables if present. Before running it, check that they point only to the intended local databases. Local seed credentials are for development only; never use them in a hosted environment.

### Build and test

```sh
npm run waybook:build
npm test --workspace=@waybook/app
```

These commands do not establish hosted or pilot readiness. Database-backed and browser tests require their own configured test environments; see the [delivery backlog](.waybook/docs/07_delivery_backlog.md) and [pilot readiness record](.waybook/docs/08_pilot_readiness.md).

## Inside the repository

```text
apps/demo/                       Waybook application and public booking routes
apps/demo/src/lib/waybook/       Booking, identity and operations logic
packages/db/src/waybook/         Control and tenant database clients and migrations
.waybook/docs/                   Architecture, decisions and delivery evidence
scripts/                         Local setup, migrations and focused verification
```

The application uses Next.js, React, TypeScript and PostgreSQL. Some shared packages are being renamed as part of the [repository identity cleanup](https://github.com/UserXpert/waybook/issues/45); they remain part of the build until their callers and behavior are verified.

## Documentation

Start with the [documentation entry point](WAYBOOK_MVP.md) and [manifest](.waybook/docs/00_manifest.md). For the current pilot, see the [delivery backlog](.waybook/docs/07_delivery_backlog.md), [readiness record](.waybook/docs/08_pilot_readiness.md), [support runbook](.waybook/docs/09_pilot_support_runbook.md) and [privacy review](.waybook/docs/10_denmark_privacy_review.md).

See the [local-to-production workflow](.waybook/docs/11_local_release_workflow.md) before reconciling local changes or deploying.

## License and attribution

See [LICENSE](LICENSE) for the applicable MIT copyright and permission notice for inherited code. Preserve third-party notices when modifying or distributing inherited components.
