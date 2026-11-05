import "server-only";

import { createWaybookSql } from "@thebookingkit/db";

const localUrl = (name: string) => `postgresql://waybook@127.0.0.1:5440/${name}`;
const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL ?? localUrl("waybook_control");

export const controlDb = createWaybookSql(controlUrl);

const tenantUrls: Record<string, string> = {
  WAYBOOK_NORDIC_STUDIO_DATABASE_URL: process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL ?? localUrl("waybook_nordic_studio"),
  WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL: process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL ?? localUrl("waybook_copenhagen_physio"),
};
const tenantClients = new Map<string, ReturnType<typeof createWaybookSql>>();

export type TenantRecord = { id: string; slug: string; name: string; lifecycleStatus: string; databaseEnvKey: string; timezone: string };

/** Returns a database client only from a Control-plane-approved connection key. */
export function tenantDb(tenant: TenantRecord) {
  const url = tenantUrls[tenant.databaseEnvKey];
  if (!url) throw new Error(`Tenant ${tenant.slug} has no approved database connection.`);
  const existing = tenantClients.get(tenant.databaseEnvKey);
  if (existing) return existing;
  const client = createWaybookSql(url);
  tenantClients.set(tenant.databaseEnvKey, client);
  return client;
}

export async function findTenantById(id: string): Promise<TenantRecord | null> {
  const rows = await controlDb<TenantRecord[]>`
    SELECT id, slug, name, lifecycle_status AS "lifecycleStatus", database_env_key AS "databaseEnvKey", timezone
    FROM tenants WHERE id = ${id} LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Resolves public tenancy on the server from a hostname registered in Control. */
export async function findTenantByHostname(hostname: string): Promise<TenantRecord | null> {
  const normalized = hostname.split(":")[0].toLowerCase();
  const rows = await controlDb<TenantRecord[]>`
    SELECT t.id, t.slug, t.name, t.lifecycle_status AS "lifecycleStatus", t.database_env_key AS "databaseEnvKey", t.timezone
    FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id
    WHERE d.hostname = ${normalized} AND t.lifecycle_status = 'active' LIMIT 1
  `;
  return rows[0] ?? null;
}
