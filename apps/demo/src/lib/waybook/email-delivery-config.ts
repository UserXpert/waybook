export function isEmailDeliveryEnabledForTenant(tenantSlug: string, environment = process.env): boolean {
  if (environment.WAYBOOK_EMAIL_DELIVERY_ENABLED !== "true") return false;
  const allowedTenant = environment.WAYBOOK_EMAIL_DELIVERY_TENANT;
  return allowedTenant === undefined || allowedTenant === tenantSlug;
}
