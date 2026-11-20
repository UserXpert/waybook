import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrationTargets } from "./waybook-migration-targets.ts";

const args = process.argv.slice(2);
if (new Set(args).size !== args.length || args.some((arg) => !["--local", "--allow-pending"].includes(arg))) throw new Error("Usage: npm run waybook:db:status [-- --local] [--allow-pending]");
const allowPending = args.includes("--allow-pending");
const targets = migrationTargets(process.env, args.includes("--local"));
const root = join(dirname(fileURLToPath(import.meta.url)), "../database/waybook/migrations");
let failed = false;
for (const target of targets) {
  const files = readdirSync(join(root, target.kind)).filter((name) => name.endsWith(".sql")).sort();
  const url = new URL(target.url);
  const sql = postgres(target.url, { max: 1, ssl: ["localhost", "127.0.0.1", "::1"].includes(url.hostname) ? false : "require", connect_timeout: 10 });
  try {
    const [table] = await sql<{ exists: boolean }[]>`SELECT to_regclass('public.waybook_schema_migrations') IS NOT NULL AS exists`;
    if (!table.exists) { failed = true; console.error(`${target.label}: migration history is missing; inspect the database before preparing it`); continue; }
    const rows = await sql<{ name: string }[]>`SELECT name FROM waybook_schema_migrations`;
    const applied = new Set(rows.map((row) => row.name));
    const expected = new Set(files);
    const pending = files.filter((file) => !applied.has(file));
    const unknown = rows.map((row) => row.name).filter((name) => !expected.has(name));
    if (pending.length || unknown.length) {
      if (unknown.length || !allowPending) failed = true;
      console.error(`${target.label}: ${pending.length} pending, ${unknown.length} unknown migration records`);
      if (pending.length) console.error(`  Pending: ${pending.join(", ")}`);
      if (unknown.length) console.error(`  Unknown: ${unknown.join(", ")}`);
    } else console.log(`${target.label}: schema history matches ${files.length} migration files`);
  } catch {
    failed = true; console.error(`${target.label}: schema status unavailable`);
  } finally { await sql.end(); }
}
if (failed) process.exitCode = 1;
