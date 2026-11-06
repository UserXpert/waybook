import "server-only";

import { tenantDb, type TenantRecord } from "./database";

/** Allows staff archiving to be shipped as a rolling tenant migration. */
export async function staffLifecycleAvailable(tenant: TenantRecord) {
  const [result] = await tenantDb(tenant)<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'team_members'
      AND column_name = 'archived_at'
  `;
  return result?.count === 1;
}
