/** Resolve API requests from the current tenant-scoped dashboard URL. */
export function tenantApiPrefix(): string {
  if (typeof window === "undefined") throw new Error("A tenant dashboard is required.");
  return tenantApiPrefixFromPath(window.location.pathname);
}

export function tenantApiPrefixFromPath(path: string): string {
  const match = path.match(/^\/([a-z0-9]+(?:-[a-z0-9]+)*)\/app(?:\/|$)/);
  if (!match) throw new Error("A tenant dashboard is required.");
  return `/${match[1]}`;
}
