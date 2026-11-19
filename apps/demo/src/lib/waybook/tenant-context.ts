import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireIdentity } from "./auth";
import { closeOverdueConfirmedBookings } from "./overdue-bookings";
import { findTenantByHostname, findTenantByRouteSlug, findTenantMembershipByRouteSlug, tenantDb, type TenantRecord } from "./database";

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
 * identity has a membership. Missing route context fails closed, including
 * for server actions, rather than guessing from a single membership.
 */
async function resolveTenantWorkspace(requestHeaders?: Headers): Promise<{ tenant: TenantRecord; membership: TenantMembership; isControlView: boolean }> {
  const identity = await requireIdentity();
  const routeSlug = (requestHeaders ?? await headers()).get("x-waybook-tenant-route");
  // A lost rewrite header must never select a different workspace.
  if (!routeSlug) notFound();
  if (routeSlug) {
    if (identity.isPlatformAdmin) {
      const tenant = await findTenantByRouteSlug(routeSlug);
      if (!tenant) notFound();
      return { tenant, membership: { tenantId: tenant.id, role: "read-only" }, isControlView: true };
    }
    const workspace = await findTenantMembershipByRouteSlug(routeSlug, identity.id);
    if (!workspace) notFound();
    const { tenant, membership } = workspace;
    await assertActiveStaffMembership(tenant, identity.id, membership);
    await closeOverdueConfirmedBookings(tenant);
    return { tenant, membership, isControlView: false };
  }
  notFound();
}

// React scopes this cache to a single server render. Explicit API headers are
// resolved separately, and no identity or tenant state survives a request.
const resolveRenderWorkspace = cache(() => resolveTenantWorkspace());

export function requireTenantWorkspace(requestHeaders?: Headers) {
  return requestHeaders ? resolveTenantWorkspace(requestHeaders) : resolveRenderWorkspace();
}

/** Resolves a tenant route for a public request; no browser-controlled DB key is accepted. */
export async function tenantForPublicRequest(requestHeaders: Headers): Promise<TenantRecord | null> {
  const routeSlug = requestHeaders.get("x-waybook-tenant-route");
  return routeSlug ? findTenantByRouteSlug(routeSlug) : findTenantByHostname(requestHeaders.get("host") ?? "");
}

export async function currentTenantRouteSlug(fallback: string): Promise<string> {
  return (await headers()).get("x-waybook-tenant-route") || fallback;
}
