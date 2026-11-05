const tenantSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isTenantRouteSlug(value: string): boolean {
  return tenantSlugPattern.test(value);
}

export function tenantPath(tenantSlug: string, path = "/app"): string {
  if (!isTenantRouteSlug(tenantSlug)) throw new Error("Invalid tenant route slug.");
  if (!path.startsWith("/")) throw new Error("Tenant paths must start with '/'.");
  return `/${tenantSlug}${path}`;
}

/** Maps a registered local tenant hostname to its stable same-origin path prefix. */
export function routeSlugFromHostname(hostname: string, fallback: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/:\d+$/, "");
  const localMatch = normalized.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\.localhost$/);
  return localMatch?.[1] ?? fallback;
}
