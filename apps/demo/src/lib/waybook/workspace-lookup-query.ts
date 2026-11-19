/** A route selects a workspace only through an active registered domain. */
export function workspaceHostname(routeSlug: string): string | null {
  const normalized = routeSlug.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? `${normalized}.localhost` : null;
}

export const workspaceMembershipQuery = `
  SELECT t.id, t.slug, t.name, t.lifecycle_status AS "lifecycleStatus", t.database_env_key AS "databaseEnvKey", t.timezone,
    m.tenant_id AS "membershipTenantId", m.role AS "membershipRole"
  FROM tenant_domains d
  JOIN tenants t ON t.id = d.tenant_id
  JOIN tenant_memberships m ON m.tenant_id = t.id AND m.identity_id = $1
  WHERE d.hostname = $2 AND t.lifecycle_status = 'active'
  LIMIT 1
`;
