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

  await sql`CREATE TABLE IF NOT EXISTS waybook_schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
  const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM waybook_schema_migrations`).map((row) => row.name));
  const completed: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const migration = readFileSync(join(migrationDirectory, file), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction.unsafe("INSERT INTO waybook_schema_migrations (name) VALUES ($1)", [file]);
    });
    completed.push(file);
  }

  await sql.end();
  return completed;
}
