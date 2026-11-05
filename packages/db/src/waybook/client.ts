import postgres, { type Sql } from "postgres";

/** Creates a bounded PostgreSQL client for one server-resolved Waybook database. */
export function createWaybookSql(databaseUrl: string): Sql<Record<string, never>> {
  return postgres(databaseUrl, {
    max: 5,
    ssl: databaseUrl.includes("localhost") || databaseUrl.includes("127.0.0.1") ? false : "require",
  });
}
