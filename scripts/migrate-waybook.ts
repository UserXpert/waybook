import { migrateWaybookDatabase } from "../packages/db/src/waybook/migrate.ts";
import { migrationTargets } from "./waybook-migration-targets.ts";

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--local") || args.length > 1) throw new Error("Usage: npm run waybook:db:migrate [-- --local]");
  const targets = migrationTargets(process.env, args.includes("--local"));
  for (const target of targets) {
    const completed = await migrateWaybookDatabase(target.url, target.kind);
    console.log(`${target.label}: ${completed.length === 0 ? "already current" : completed.join(", ")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
