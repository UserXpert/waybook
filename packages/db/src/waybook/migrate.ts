import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

export type WaybookDatabaseKind = "control" | "tenant";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

/** Applies each pending Waybook SQL migration to one local PostgreSQL database. */
export async function migrateWaybookDatabase(databaseUrl: string, kind: WaybookDatabaseKind): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1, ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1") ? false : "require" });
  const migrationDirectory = join(moduleDirectory, "migrations", kind);
  const files = readdirSync(migrationDirectory).filter((file) => file.endsWith(".sql")).sort();

  // Transaction-scoped locks also work through transaction-pooling proxies.
  // Every runner processes the same ordered files and rechecks each one while
  // holding the lock, so concurrent deployments cannot apply it twice.
  try {
    await sql.begin(async (transaction) => {
      await transaction.unsafe("SELECT pg_advisory_xact_lock(hashtext('waybook_schema_migrations'))");
      await transaction.unsafe("CREATE TABLE IF NOT EXISTS waybook_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    });
    const completed: string[] = [];

    for (const file of files) {
      const migration = readFileSync(join(migrationDirectory, file), "utf8");
      const applied = await sql.begin(async (transaction) => {
        await transaction.unsafe("SELECT pg_advisory_xact_lock(hashtext('waybook_schema_migrations'))");
        const existing = await transaction.unsafe("SELECT 1 FROM waybook_schema_migrations WHERE name = $1", [file]);
        if (existing.length) return false;
        await transaction.unsafe(migration);
        await transaction.unsafe("INSERT INTO waybook_schema_migrations (name) VALUES ($1)", [file]);
        return true;
      });
      if (applied) completed.push(file);
    }
    return completed;
  } finally {
    await sql.end();
  }
}
