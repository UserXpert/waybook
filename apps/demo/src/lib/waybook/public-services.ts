/** Only offer a service at locations where the business assigned it. */
export function servicesAtLocation<T extends { locationIds: string[] }>(services: T[], locationId: string): T[] {
  return locationId ? services.filter((service) => service.locationIds.includes(locationId)) : [];
}
