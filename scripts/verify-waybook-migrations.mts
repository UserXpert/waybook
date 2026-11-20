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

await verifyFreshInstallAndNoop();
await verifyPrefixUpgradeAndRollback();
await verifyConcurrentRunners();
console.log("Waybook migration new-install, history, upgrade, rollback, and concurrency verification passed.");
