"use server";

import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/waybook/auth";
import { controlDb } from "@/lib/waybook/database";
import { featureKeys } from "@/lib/waybook/features";

export async function setTenantLifecycle(formData: FormData) {
  const identity = await requireIdentity();
  if (!identity.isPlatformAdmin) throw new Error("Platform administrator required.");
  const tenantId = String(formData.get("tenantId") ?? "");
  const lifecycle = String(formData.get("lifecycle") ?? "");
  if (!tenantId || !["active", "suspended"].includes(lifecycle)) throw new Error("Invalid lifecycle request.");
  await controlDb`UPDATE tenants SET lifecycle_status = ${lifecycle}, suspended_at = CASE WHEN ${lifecycle} = 'suspended' THEN now() ELSE NULL END, updated_at = now() WHERE id = ${tenantId}`;
  await controlDb`INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id) VALUES (${identity.id}, ${tenantId}, ${`tenant.${lifecycle}`}, 'tenant', ${tenantId})`;
  revalidatePath("/control");
}

/** Platform-only mutation of a persisted tenant feature state. */
export async function setTenantFeature(formData: FormData) {
  const identity = await requireIdentity();
  if (!identity.isPlatformAdmin) throw new Error("Platform administrator required.");
  const tenantId = String(formData.get("tenantId") ?? "");
  const featureKey = String(formData.get("featureKey") ?? "");
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!tenantId || !featureKeys.includes(featureKey as (typeof featureKeys)[number])) throw new Error("Invalid feature request.");
  const [definition] = await controlDb<{ isBaseline: boolean }[]>`SELECT is_baseline AS "isBaseline" FROM feature_definitions WHERE feature_key = ${featureKey}`;
  if (!definition) throw new Error("Unknown feature.");
  if (definition.isBaseline && !enabled) throw new Error("Booking essentials cannot be disabled.");
  await controlDb`UPDATE tenant_feature_states SET is_enabled = ${enabled}, updated_by_identity_id = ${identity.id}, updated_at = now() WHERE tenant_id = ${tenantId} AND feature_key = ${featureKey}`;
  await controlDb`INSERT INTO platform_audit_events (actor_identity_id, tenant_id, action, target_type, target_id, metadata) VALUES (${identity.id}, ${tenantId}, ${enabled ? "tenant.feature.enabled" : "tenant.feature.disabled"}, 'tenant_feature', ${`${tenantId}:${featureKey}`}, ${JSON.stringify({ featureKey, enabled })}::jsonb)`;
  revalidatePath("/control");
  revalidatePath("/app");
  revalidatePath("/app/customers");
  revalidatePath("/book");
}
