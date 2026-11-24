import "server-only";

import { cache } from "react";
import { tenantDb, type TenantRecord } from "./database";
import { isClientTerm, isStaffTerm, terminologyLabels, type TerminologyPreferences } from "./terminology-labels";

export const getTenantTerminologySettings = cache(async (tenant: TenantRecord) => {
  try {
    const [row] = await tenantDb(tenant)<{ clientTerm: string; staffTerm: string }[]>`
      SELECT client_term AS "clientTerm", staff_term AS "staffTerm"
      FROM tenant_terminology WHERE tenant_id = ${tenant.id}
    `;
    const preferences: TerminologyPreferences = {
      clientTerm: isClientTerm(row?.clientTerm) ? row.clientTerm : "client",
      staffTerm: isStaffTerm(row?.staffTerm) ? row.staffTerm : "staff",
    };
    return { available: true, preferences };
  } catch (error) {
    // Keep the established labels on a database awaiting migration 0056.
    if (error instanceof Error && "code" in error && error.code === "42P01") {
      return { available: false, preferences: { clientTerm: "client", staffTerm: "staff" } as const };
    }
    throw error;
  }
});

export const getTenantTerminology = cache(async (tenant: TenantRecord) => {
  const { preferences } = await getTenantTerminologySettings(tenant);
  return terminologyLabels(preferences.clientTerm, preferences.staffTerm);
});
