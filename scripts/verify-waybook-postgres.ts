import postgres from "postgres";

type Row = Record<string, unknown>;

const requiredTenantTables = [
  "tenant_settings",
  "bookings",
  "payment_records",
  "commerce_sales",
  "commerce_sale_transactions",
];

async function verifyDatabase(label: string, url: string, requiredTables: string[], requiresBookingExtension: boolean) {
  const sql = postgres(url, { max: 1, ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require" });
  try {
    const [{ server_version_num: version }] = await sql<{ server_version_num: string }[]>`SHOW server_version_num`;
    if (Number(version) < 150000) throw new Error(`${label} must run PostgreSQL 15 or newer; found ${version}.`);
    if (requiresBookingExtension) {
      const extensions = await sql<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = 'btree_gist'`;
      if (extensions.length !== 1) throw new Error(`${label} is missing the required btree_gist extension.`);
    }
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${requiredTables})
    `;
    const present = new Set(tables.map((row) => row.table_name));
    const missing = requiredTables.filter((table) => !present.has(table));
    if (missing.length) throw new Error(`${label} is missing migrated tables: ${missing.join(", ")}.`);
    const migrations = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM waybook_schema_migrations`;
    if (!migrations[0]?.count) throw new Error(`${label} has no recorded Waybook migrations.`);
    console.log(`${label}: PostgreSQL ${version}, ${requiresBookingExtension ? "btree_gist, " : ""}${migrations[0].count} migrations, required tables present.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL;
  const tenantUrls = [
    ["Nordic Studio", process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL],
    ["Copenhagen Physio", process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL],
  ] as const;
  if (!controlUrl || tenantUrls.some(([, url]) => !url)) {
    throw new Error("Set WAYBOOK_CONTROL_DATABASE_URL, WAYBOOK_NORDIC_STUDIO_DATABASE_URL, and WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL before running this preflight.");
  }
  await verifyDatabase("Control", controlUrl, ["tenants", "tenant_memberships", "waybook_schema_migrations"], false);
  for (const [label, url] of tenantUrls) await verifyDatabase(label, url!, requiredTenantTables, true);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
