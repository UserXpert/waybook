import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

import { migrateWaybookDatabase } from "../database/waybook/migrate.ts";

type DatabaseKind = "control" | "tenant";
type MigrationRow = { name: string; appliedAt: Date };

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = join(repositoryRoot, "database", "waybook", "migrations");
const adminUrl = process.env.WAYBOOK_MIGRATION_TEST_DATABASE_URL;
const loopbackHosts = new Set(["localhost", "127.0.0.1"]);

if (!adminUrl) {
  throw new Error("Set WAYBOOK_MIGRATION_TEST_DATABASE_URL to a loopback PostgreSQL admin URL ending in /postgres.");
}

const parsedAdminUrl = new URL(adminUrl);
if (
  !["postgres:", "postgresql:"].includes(parsedAdminUrl.protocol)
  || !loopbackHosts.has(parsedAdminUrl.hostname)
  || parsedAdminUrl.pathname !== "/postgres"
  || parsedAdminUrl.search
  || parsedAdminUrl.hash
) {
  throw new Error("WAYBOOK_MIGRATION_TEST_DATABASE_URL must use a loopback PostgreSQL URL ending in /postgres without connection options.");
}

function migrationFiles(kind: DatabaseKind) {
  return readdirSync(join(migrationRoot, kind)).filter((name) => name.endsWith(".sql")).sort();
}

function migrationText(kind: DatabaseKind, file: string) {
  return readFileSync(join(migrationRoot, kind, file), "utf8");
}

function fixtureUrl(name: string) {
  const url = new URL(adminUrl!);
  url.pathname = `/${name}`;
  return url.toString();
}

function fixtureName(label: string) {
  return `waybook_migration_${label}_${process.pid}_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

function localSql(url: string, max = 1) {
  return postgres(url, { max, ssl: false, connect_timeout: 10 });
}

async function withFixture(label: string, run: (url: string) => Promise<void>) {
  const name = fixtureName(label);
  const admin = localSql(adminUrl!);
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    await run(fixtureUrl(name));
  } finally {
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await admin.end();
    }
  }
}

async function appliedRows(url: string): Promise<Array<{ name: string; appliedAt: string }>> {
  const sql = localSql(url);
  try {
    const rows = await sql<MigrationRow[]>`SELECT name, applied_at AS "appliedAt" FROM waybook_schema_migrations ORDER BY name`;
    return rows.map((row) => ({ name: row.name, appliedAt: row.appliedAt.toISOString() }));
  } finally {
    await sql.end();
  }
}

/** Install an existing prefix exactly as a prior runner would have done. */
async function applyExistingPrefix(url: string, kind: DatabaseKind, files: string[]) {
  const sql = localSql(url);
  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe("SELECT pg_advisory_xact_lock(hashtext('waybook_schema_migrations'))");
      for (const file of files) {
        await transaction.unsafe(migrationText(kind, file));
        await transaction.unsafe("INSERT INTO waybook_schema_migrations (name) VALUES ($1)", [file]);
      }
    });
  } finally {
    await sql.end();
  }
}

async function installHistoryInsertFailure(url: string, blockedFile: string) {
  const sql = localSql(url);
  try {
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION waybook_migration_verifier_reject_history_insert() RETURNS trigger AS $$
      BEGIN
        IF NEW.name = '${blockedFile}' THEN
          RAISE EXCEPTION 'intentional migration verifier history failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
      CREATE TRIGGER waybook_migration_verifier_history_guard
      BEFORE INSERT ON waybook_schema_migrations
      FOR EACH ROW EXECUTE FUNCTION waybook_migration_verifier_reject_history_insert();
    `);
  } finally {
    await sql.end();
  }
}

async function removeHistoryInsertFailure(url: string) {
  const sql = localSql(url);
  try {
    await sql.unsafe("DROP TRIGGER IF EXISTS waybook_migration_verifier_history_guard ON waybook_schema_migrations");
    await sql.unsafe("DROP FUNCTION IF EXISTS waybook_migration_verifier_reject_history_insert()");
  } finally {
    await sql.end();
  }
}

async function relationExists(url: string, relation: string) {
  const sql = localSql(url);
  try {
    const [row] = await sql<{ exists: boolean }[]>`SELECT to_regclass(${relation}) IS NOT NULL AS exists`;
    return row?.exists ?? false;
  } finally {
    await sql.end();
  }
}

async function verifyFreshInstallAndNoop() {
  const expected = migrationFiles("tenant");
  await withFixture("fresh", async (url) => {
    assert.deepEqual(await migrateWaybookDatabase(url, "tenant"), expected, "a new tenant database must apply every migration in filename order");
    const firstHistory = await appliedRows(url);
    assert.deepEqual(firstHistory.map((row) => row.name), expected);
    assert.ok(firstHistory.every((row) => Number.isFinite(Date.parse(row.appliedAt))), "new migration records need timestamps");

    assert.deepEqual(await migrateWaybookDatabase(url, "tenant"), [], "a complete history must be a no-op");
    assert.deepEqual(await appliedRows(url), firstHistory, "a no-op must not alter applied migration rows or timestamps");
  });
}

async function verifyPrefixUpgradeAndRollback() {
  const files = migrationFiles("control");
  assert.ok(files.length >= 2, "control migration fixture requires a real prefix and suffix");
  const prefix = files.slice(0, 1);
  const next = files[1]!;

  await withFixture("prefix", async (url) => {
    await applyExistingPrefix(url, "control", prefix);
    const before = await appliedRows(url);
    assert.deepEqual(before.map((row) => row.name), prefix, "fixture must begin with an actual applied prefix");

    assert.deepEqual(await migrateWaybookDatabase(url, "control"), files.slice(prefix.length), "runner must upgrade an existing history to the canonical full history");
    const upgraded = await appliedRows(url);
    assert.deepEqual(upgraded.map((row) => row.name), files);
    assert.deepEqual(upgraded.slice(0, prefix.length), before, "existing history rows and timestamps must survive an upgrade");
  });

  await withFixture("rollback", async (url) => {
    await applyExistingPrefix(url, "control", prefix);
    const before = await appliedRows(url);
    await installHistoryInsertFailure(url, next);
    try {
      await assert.rejects(migrateWaybookDatabase(url, "control"), /intentional migration verifier history failure/);
      assert.deepEqual(await appliedRows(url), before, "a failed next migration must not create a history row");
      assert.equal(await relationExists(url, "public.feature_definitions"), false, "the failed migration transaction must not leave its table behind");
    } finally {
      await removeHistoryInsertFailure(url);
    }
    assert.deepEqual(await migrateWaybookDatabase(url, "control"), files.slice(prefix.length), "removing the fixture trigger must permit the same canonical upgrade");
  });
}

async function verifyConcurrentRunners() {
  const expected = migrationFiles("tenant");
  await withFixture("concurrent", async (url) => {
    const results = await Promise.allSettled([
      migrateWaybookDatabase(url, "tenant"),
      migrateWaybookDatabase(url, "tenant"),
    ]);
    const applied = results.flatMap((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    assert.deepEqual(applied.sort(), expected, "concurrent runners must report each migration exactly once across both runs");
    assert.deepEqual((await appliedRows(url)).map((row) => row.name), expected, "concurrent runners must leave exactly one complete history");
  });
}

async function verifyLinkedAppointmentServices() {
  const files = migrationFiles("tenant");
  const linkedMigration = "0064_linked_appointment_services.sql";
  const prefix = files.slice(0, files.indexOf(linkedMigration));
  await withFixture("linked_services", async (url) => {
    await applyExistingPrefix(url, "tenant", prefix);
    const sql = localSql(url);
    try {
      const tenant = randomUUID();
      await sql`INSERT INTO tenant_settings (tenant_id, name) VALUES (${tenant}, 'Studio')`;
      const [location] = await sql`INSERT INTO locations (tenant_id, slug, name) VALUES (${tenant}, 'test', 'Studio') RETURNING id`;
      const [member] = await sql`INSERT INTO team_members (tenant_id, name, email, role) VALUES (${tenant}, 'Provider', 'provider@example.test', 'staff') RETURNING id`;
      const [client] = await sql`INSERT INTO customers (tenant_id, name, email) VALUES (${tenant}, 'Client', 'client@example.test') RETURNING id`;
      const [primary, added] = await sql`
        INSERT INTO services (tenant_id, slug, title, duration_minutes, price_cents)
        VALUES (${tenant}, 'primary', 'Primary', 45, 7000), (${tenant}, 'added', 'Added', 30, 3000)
        RETURNING id
      `;
      const reserve = async (start: string, end: string) => (await sql<{ id: string }[]>`
        INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
        VALUES (${tenant}, ${member.id}, ${location.id}, ${start}, ${end}, 'confirmed') RETURNING id
      `)[0]!.id;
      const firstStart = "2030-06-01T10:00:00Z";
      const boundary = "2030-06-01T10:45:00Z";
      const extraEnd = "2030-06-01T11:15:00Z";
      const firstBlock = await reserve(firstStart, boundary);
      const [booking] = await sql`
        INSERT INTO bookings (tenant_id, booking_block_id, service_id, location_id, team_member_id, customer_id,
          starts_at, ends_at, booked_price_cents, status, source)
        VALUES (${tenant}, ${firstBlock}, ${primary.id}, ${location.id}, ${member.id}, ${client.id},
          ${firstStart}, ${boundary}, 7000, 'confirmed', 'tenant') RETURNING id
      `;
      const total = async () => Number((await sql`SELECT chargeable_cents FROM appointment_checkout_amounts(${tenant}, ${booking.id})`)[0]?.chargeable_cents);
      assert.equal(await total(), 7000);
      const history = await appliedRows(url);
      const pending = files.slice(prefix.length);
      assert.equal(pending[0], linkedMigration);
      assert.deepEqual(await migrateWaybookDatabase(url, "tenant"), pending);
      assert.deepEqual((await appliedRows(url)).slice(0, prefix.length), history);
      assert.equal(await total(), 7000, "existing appointments must retain their price on upgrade");

      const extraBlock = await reserve(boundary, extraEnd);
      const link = (tenantId: string, blockId: string) => sql`
        INSERT INTO booking_service_segments (tenant_id, booking_id, booking_block_id, service_id, position, booked_price_cents)
        VALUES (${tenantId}, ${booking.id}, ${blockId}, ${added.id}, 2, 3000)
      `;
      await assert.rejects(link(randomUUID(), extraBlock), /same tenant/);
      await assert.rejects(link(tenant, firstBlock), /separate confirmed reservation/);
      await link(tenant, extraBlock);
      assert.equal(await total(), 10000, "the existing payment ledger must see both service prices");
      assert.equal((await sql`SELECT count(*)::int AS count FROM commerce_sales WHERE tenant_id = ${tenant} AND booking_id = ${booking.id}`)[0]?.count, 1);
      await assert.rejects(reserve(boundary, extraEnd), { code: "23P01" });
      await assert.rejects(sql.begin(async (transaction) => {
        await transaction`
          INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
          VALUES (${tenant}, ${member.id}, ${location.id}, '2030-06-01T09:30:00Z', ${firstStart}, 'confirmed')
        `;
        await transaction`
          INSERT INTO booking_blocks (tenant_id, team_member_id, location_id, starts_at, ends_at, state)
          VALUES (${tenant}, ${member.id}, ${location.id}, ${boundary}, ${extraEnd}, 'confirmed')
        `;
      }), { code: "23P01" });
      await reserve("2030-06-01T09:30:00Z", firstStart);
      const recordPayment = (amount: number) => sql`
        INSERT INTO payment_records (tenant_id, booking_id, kind, amount_cents, method)
        VALUES (${tenant}, ${booking.id}, 'payment', ${amount}, 'cash')
      `;
      await assert.rejects(recordPayment(10001), /cannot exceed/);
      await recordPayment(10000);
      await assert.rejects(sql`DELETE FROM booking_service_segments WHERE booking_id = ${booking.id}`, /payment has been recorded/);
      await sql`UPDATE bookings SET status = 'cancelled' WHERE id = ${booking.id}`;
      assert.equal((await sql`SELECT state FROM booking_blocks WHERE id = ${extraBlock}`)[0]?.state, "cancelled");
      await reserve(boundary, extraEnd);
    } finally {
      await sql.end();
    }
  });
}

await verifyFreshInstallAndNoop();
await verifyPrefixUpgradeAndRollback();
await verifyConcurrentRunners();
await verifyLinkedAppointmentServices();
console.log("Waybook migration new-install, history, upgrade, rollback, concurrency, and linked appointment verification passed.");
