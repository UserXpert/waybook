function hostnameFrom(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

function portFrom(host: string): string {
  const match = host.trim().match(/:(\d+)$/);
  return match ? `:${match[1]}` : "";
}

/**
 * Builds the Control dashboard's tenant-workspace link from the server request
 * host. Local development keeps tenant subdomains; hosted environments stay on
 * the deployed Waybook origin until tenant domains are provisioned.
 */
export function tenantDashboardHref(requestHost: string, tenantLocalHostname: string, tenantHostedHostname?: string): string {
  const requestHostname = hostnameFrom(requestHost);
  if (requestHostname === "localhost" || requestHostname.endsWith(".localhost")) {
    return `http://${tenantLocalHostname}${portFrom(requestHost)}/app`;
  }
  if (tenantHostedHostname) return `https://${tenantHostedHostname}/app`;
  return `https://${requestHost.trim()}/app`;
}
