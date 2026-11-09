# AWS RDS cutover runbook

## Status

**Designed / preflight-tested. No AWS resources or hosted configuration have
been changed.** The read-only preflight against the configured hosted database
URLs confirmed that Control is reachable on PostgreSQL 18, but Nordic is behind
local schema state and does not yet contain `commerce_sales` or
`commerce_sale_transactions`. That drift must be resolved in staging before a
source export or an AWS cutover is considered.

Waybook uses standard PostgreSQL 15+ URLs via `postgres.js`; no application
code depends on a Neon-specific driver or API. The destination can therefore
be Amazon RDS for PostgreSQL while preserving the existing Control database
plus tenant database isolation model.

## Recommended target

- Region: `ap-southeast-2`, matching the signed-in AWS account inventory.
- One encrypted RDS PostgreSQL instance/cluster, version 15 or newer, with
  separate `waybook_control`, `waybook_nordic_studio`, and
  `waybook_copenhagen_physio` databases.
- Private subnets, no public database endpoint, TLS required, least-privilege
  migration and runtime roles, automated backups and point-in-time recovery.
- Run the Next.js service inside AWS (App Runner plus a VPC connector is the
  recommended first option) so the database security group only accepts that
  workload. If Vercel remains the host, use a paid static-egress or PrivateLink
  option; never open PostgreSQL to the internet.

## Cutover gates

1. Create the destination network, encrypted RDS PostgreSQL, Secrets Manager
   entries, and runtime/migration IAM roles through reviewed infrastructure as
   code.
2. Confirm the required `btree_gist` extension and PostgreSQL 15+ support.
3. Set the three `WAYBOOK_*_DATABASE_URL` variables only in a staging
   environment and run all tenant migrations.
4. Run `npx tsx scripts/verify-waybook-postgres.ts` against the destination.
   It fails if the server version, required extension, migration history, or
   core tenant tables are missing.
5. Export each existing source database consistently; restore into its matching
   target database; validate counts, extension constraints, and tenant routing.
6. For a short maintenance cutover, stop writes, perform a final logical
   export/import, rerun migration/preflight, test Nordic and Copenhagen, then
   change runtime secrets and deploy the application.
7. Retain the old provider read-only for a defined rollback window. Do not
   delete snapshots or source data until restore drills and sign-off succeed.

## When continuous replication is justified

For a small seeded test estate, a maintenance-window `pg_dump`/`pg_restore`
cutover is simpler and has fewer moving parts. For a live high-write tenant,
use AWS DMS full load plus change data capture, validate lag and row counts,
then perform a brief write freeze for the final cutover. DMS/CDC is not a
substitute for application-level tenant and booking-conflict verification.

## Acceptance evidence

- Infrastructure plan reviewed before apply.
- RDS encryption, private networking, backup retention, and security-group
  rules evidenced in AWS.
- Preflight passes against Control and every tenant database.
- Migration history is complete in every destination database.
- Browser-tested booking, payment, sales, and client flows pass for Nordic and
  Copenhagen after the environment switch.
- A restore drill proves a point-in-time backup can produce a working staging
  database.
