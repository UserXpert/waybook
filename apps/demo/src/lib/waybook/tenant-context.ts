import "server-only";

import { headers } from "next/headers";
import { requireIdentity } from "./auth";
import { controlDb, findTenantByHostname, findTenantById, findTenantByRouteSlug, type TenantRecord } from "./database";

export type TenantMembership = { tenantId: string; role: string };

/**
 * Resolves the route-selected workspace only after checking the signed-in
 * identity has a membership. Legacy routes retain their single-membership
 * fallback while the same-origin URLs are rolled out.
 */
export async function requireTenantWorkspace(): Promise<{ tenant: TenantRecord; membership: TenantMembership }> {
  const identity = await requireIdentity();
  if (identity.isPlatformAdmin) throw new Error("Platform administrators do not have a tenant workspace.");
  const routeSlug = (await headers()).get("x-waybook-tenant-route");
  if (routeSlug) {
    const tenant = await findTenantByRouteSlug(routeSlug);
    if (!tenant) throw new Error("Tenant workspace is unavailable.");
    const [membership] = await controlDb<TenantMembership[]>`
      SELECT tenant_id AS "tenantId", role FROM tenant_memberships
      WHERE identity_id = ${identity.id} AND tenant_id = ${tenant.id} LIMIT 1
    `;
    if (!membership) throw new Error("You do not have access to this tenant workspace.");
    return { tenant, membership };
  }
  const memberships = await controlDb<TenantMembership[]>`
    SELECT tenant_id AS "tenantId", role FROM tenant_memberships WHERE identity_id = ${identity.id} LIMIT 2
  `;
  if (memberships.length !== 1) throw new Error("Choose a tenant workspace.");
  const tenant = await findTenantById(memberships[0].tenantId);
  if (!tenant || tenant.lifecycleStatus !== "active") throw new Error("Tenant workspace is unavailable.");
  return { tenant, membership: memberships[0] };
}

/** Resolves a tenant route for a public request; no browser-controlled DB key is accepted. */
export async function tenantForPublicRequest(requestHeaders: Headers): Promise<TenantRecord | null> {
  const routeSlug = requestHeaders.get("x-waybook-tenant-route");
  return routeSlug ? findTenantByRouteSlug(routeSlug) : findTenantByHostname(requestHeaders.get("host") ?? "");
}

export async function currentTenantRouteSlug(fallback: string): Promise<string> {
  return (await headers()).get("x-waybook-tenant-route") || fallback;
}
