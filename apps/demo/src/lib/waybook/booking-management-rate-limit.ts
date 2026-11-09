import "server-only";
import { tenantDb, type TenantRecord } from "./database";
import { consumeManagementBuckets } from "./booking-management-rate-limit-core";

/** Shared database-backed tenant and booking-reference limits; failures must fail closed. */
export async function consumeBookingManagementAttempt(tenant: TenantRecord, bookingId: string): Promise<boolean> {
  return tenantDb(tenant).begin(async transaction => consumeManagementBuckets({ unsafe: (query, parameters) => transaction.unsafe(query, parameters) }, tenant.id, bookingId));
}
