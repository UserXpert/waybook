import { migrateWaybookDatabase } from "../packages/db/src/waybook/migrate.ts";

const local = (name: string) => `postgresql://waybook@127.0.0.1:5440/${name}`;
const targets = [
  { label: "Control", kind: "control" as const, url: process.env.WAYBOOK_CONTROL_DATABASE_URL ?? local("waybook_control") },
  { label: "Nordic Studio", kind: "tenant" as const, url: process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL ?? local("waybook_nordic_studio") },
  { label: "Copenhagen Physio", kind: "tenant" as const, url: process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL ?? local("waybook_copenhagen_physio") },
];

async function main() {
  for (const target of targets) {
    const completed = await migrateWaybookDatabase(target.url, target.kind);
    console.log(`${target.label}: ${completed.length === 0 ? "already current" : completed.join(", ")}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
