import "server-only";

import { headers } from "next/headers";
import { requireIdentity } from "./auth";
import { closeOverdueConfirmedBookings } from "./overdue-bookings";
import { controlDb, findTenantByHostname, findTenantById, findTenantByRouteSlug, tenantDb, type TenantRecord } from "./database";

export type TenantMembership = { tenantId: string; role: string };

async function assertActiveStaffMembership(tenant: TenantRecord, identityId: string, membership: TenantMembership) {
  const [staff] = await tenantDb(tenant)<{ isActive: boolean }[]>`
    SELECT is_active AS "isActive" FROM team_members
    WHERE tenant_id = ${tenant.id} AND identity_id = ${identityId}
    LIMIT 1
  `;
  // A linked profile is the lifecycle authority for every workspace role.
  // Legacy owners can have no profile, but staff/read-only identities cannot.
  if (staff && !staff.isActive) throw new Error("Your staff access is inactive for this workspace.");
  if (!staff && ["staff", "read-only"].includes(membership.role)) {
    throw new Error("Your staff profile is unavailable for this workspace.");
  }
}

/**
 * Resolves the route-selected workspace only after checking the signed-in
 * identity has a membership. Legacy routes retain their single-membership
 * fallback while the same-origin URLs are rolled out.
 */
export async function requireTenantWorkspace(): Promise<{ tenant: TenantRecord; membership: TenantMembership; isControlView: boolean }> {
  const identity = await requireIdentity();
  const routeSlug = (await headers()).get("x-waybook-tenant-route");
  if (routeSlug) {
    const tenant = await findTenantByRouteSlug(routeSlug);
    if (!tenant) throw new Error("Tenant workspace is unavailable.");
    if (identity.isPlatformAdmin) {
      return { tenant, membership: { tenantId: tenant.id, role: "read-only" }, isControlView: true };
    }
    const [membership] = await controlDb<TenantMembership[]>`
      SELECT tenant_id AS "tenantId", role FROM tenant_memberships
      WHERE identity_id = ${identity.id} AND tenant_id = ${tenant.id} LIMIT 1
    `;
    if (!membership) throw new Error("You do not have access to this tenant workspace.");
    await assertActiveStaffMembership(tenant, identity.id, membership);
    await closeOverdueConfirmedBookings(tenant);
    return { tenant, membership, isControlView: false };
  }
  const memberships = await controlDb<TenantMembership[]>`
    SELECT tenant_id AS "tenantId", role FROM tenant_memberships WHERE identity_id = ${identity.id} LIMIT 2
  `;
  if (memberships.length !== 1) throw new Error("Choose a tenant workspace.");
  const tenant = await findTenantById(memberships[0].tenantId);
  if (!tenant || tenant.lifecycleStatus !== "active") throw new Error("Tenant workspace is unavailable.");
  await assertActiveStaffMembership(tenant, identity.id, memberships[0]);
  await closeOverdueConfirmedBookings(tenant);
  return { tenant, membership: memberships[0], isControlView: false };
}

/** Resolves a tenant route for a public request; no browser-controlled DB key is accepted. */
export async function tenantForPublicRequest(requestHeaders: Headers): Promise<TenantRecord | null> {
  const routeSlug = requestHeaders.get("x-waybook-tenant-route");
  return routeSlug ? findTenantByRouteSlug(routeSlug) : findTenantByHostname(requestHeaders.get("host") ?? "");
}

export async function currentTenantRouteSlug(fallback: string): Promise<string> {
  return (await headers()).get("x-waybook-tenant-route") || fallback;
}
