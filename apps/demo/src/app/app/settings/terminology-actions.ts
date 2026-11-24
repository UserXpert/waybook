"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { tenantDb } from "@/lib/waybook/database";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { getTenantTerminologySettings } from "@/lib/waybook/tenant-terminology";
import { isClientTerm, isStaffTerm } from "@/lib/waybook/terminology-labels";

export type TerminologyFormState = { error?: string; saved?: boolean };

export async function saveTenantTerminology(_: TerminologyFormState, data: FormData): Promise<TerminologyFormState> {
  const { tenant, membership } = await requireTenantWorkspace();
  if (membership.role !== "owner") return { error: "Only the workspace owner can change terminology." };
  const clientTerm = data.get("clientTerm");
  const staffTerm = data.get("staffTerm");
  if (!isClientTerm(clientTerm) || !isStaffTerm(staffTerm)) return { error: "Choose an available term in each field." };
  if (!(await getTenantTerminologySettings(tenant)).available) return { error: "Update the workspace database before saving terminology." };

  const actor = await requireIdentity();
  const metadata = JSON.stringify({ clientTerm, staffTerm });
  await tenantDb(tenant)`
    WITH changed AS (
      INSERT INTO tenant_terminology (tenant_id, client_term, staff_term)
      VALUES (${tenant.id}, ${clientTerm}, ${staffTerm})
      ON CONFLICT (tenant_id) DO UPDATE SET client_term = EXCLUDED.client_term, staff_term = EXCLUDED.staff_term
      WHERE (tenant_terminology.client_term, tenant_terminology.staff_term) IS DISTINCT FROM (EXCLUDED.client_term, EXCLUDED.staff_term)
      RETURNING tenant_id
    )
    INSERT INTO tenant_audit_events (tenant_id, actor_identity_id, action, target_type, target_id, metadata)
    SELECT tenant_id, ${actor.id}, 'tenant.terminology.updated', 'tenant_settings', tenant_id, ${metadata}::text::jsonb
    FROM changed
  `;
  const slug = await currentTenantRouteSlug(tenant.slug);
  revalidatePath("/app", "layout");
  revalidatePath(tenantPath(slug, "/app"), "layout");
  revalidatePath("/book");
  revalidatePath(tenantPath(slug, "/book"));
  return { saved: true };
}
