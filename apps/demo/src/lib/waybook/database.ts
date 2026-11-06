import "server-only";

import { createWaybookSql } from "@thebookingkit/db";

const localUrl = (name: string) => `postgresql://waybook@127.0.0.1:5440/${name}`;
const controlUrl = process.env.WAYBOOK_CONTROL_DATABASE_URL ?? localUrl("waybook_control");
type WaybookSql = ReturnType<typeof createWaybookSql>;

/**
 * Next development reloads server modules without ending their module-scoped
 * postgres pools. Keep these process-local clients on globalThis so a long
 * local design or browser session stays bounded instead of exhausting Postgres.
 */
const globalConnections = globalThis as typeof globalThis & {
  __waybookControlDb?: WaybookSql;
  __waybookTenantClients?: Map<string, WaybookSql>;
};

export const controlDb = globalConnections.__waybookControlDb ?? createWaybookSql(controlUrl);
globalConnections.__waybookControlDb = controlDb;

const tenantUrls: Record<string, string> = {
  WAYBOOK_NORDIC_STUDIO_DATABASE_URL: process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL ?? localUrl("waybook_nordic_studio"),
  WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL: process.env.WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL ?? localUrl("waybook_copenhagen_physio"),
};
const tenantClients = globalConnections.__waybookTenantClients ?? new Map<string, WaybookSql>();
globalConnections.__waybookTenantClients = tenantClients;

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

/** Resolves a same-origin tenant route through the Control domain registry. */
export async function findTenantByRouteSlug(routeSlug: string): Promise<TenantRecord | null> {
  const normalized = routeSlug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) return null;
  const rows = await controlDb<TenantRecord[]>`
    SELECT t.id, t.slug, t.name, t.lifecycle_status AS "lifecycleStatus", t.database_env_key AS "databaseEnvKey", t.timezone
    FROM tenant_domains d JOIN tenants t ON t.id = d.tenant_id
    WHERE d.hostname = ${`${normalized}.localhost`} AND t.lifecycle_status = 'active'
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function findTenantRouteSlug(tenantId: string, fallback: string): Promise<string> {
  const rows = await controlDb<{ hostname: string }[]>`
    SELECT hostname FROM tenant_domains WHERE tenant_id = ${tenantId} AND hostname LIKE '%.localhost'
    ORDER BY is_primary DESC, created_at ASC LIMIT 1
  `;
  return rows[0]?.hostname.split(".")[0] ?? fallback;
}
