import "server-only";
import { tenantDb, type TenantRecord } from "./database";
import { isServicePubliclyVisible } from "./public-booking-rules";

/** Enforce the same online service visibility as the public booking page. */
export async function publicServiceAllowed(tenant: TenantRecord, service: string): Promise<boolean> {
  const db = tenantDb(tenant);
  const [row] = await db<{ id: string; bookingPage: unknown }[]>`
    SELECT s.id::text AS id, ts.booking_page AS "bookingPage"
    FROM services s JOIN tenant_settings ts ON ts.tenant_id = s.tenant_id
    WHERE s.tenant_id = ${tenant.id} AND s.is_active = TRUE
      AND (s.id::text = ${service} OR s.slug = ${service})
    LIMIT 1`;
  return !!row && isServicePubliclyVisible(row.id, row.bookingPage);
}
