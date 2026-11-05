function hostnameFrom(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

/**
 * Builds the Control dashboard's tenant-workspace link from the server request
 * host. Local development keeps tenant subdomains; hosted environments stay on
 * the deployed Waybook origin until tenant domains are provisioned.
 */
export function tenantDashboardHref(requestHost: string, tenantRouteSlug: string): string {
  const requestHostname = hostnameFrom(requestHost);
  const protocol = requestHostname === "localhost" || requestHostname.endsWith(".localhost") ? "http" : "https";
  return `${protocol}://${requestHost.trim()}/${tenantRouteSlug}/app`;
}
