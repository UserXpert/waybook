import "server-only";

import { controlDb } from "./database";

export const featureKeys = ["booking-essentials", "clients", "team", "calendars", "resources", "email-notifications"] as const;
export type FeatureKey = (typeof featureKeys)[number];

export type TenantFeatureState = { featureKey: FeatureKey; label: string; description: string; isBaseline: boolean; isEnabled: boolean };

export async function tenantFeatures(tenantId: string): Promise<TenantFeatureState[]> {
  return controlDb<TenantFeatureState[]>`
    SELECT f.feature_key AS "featureKey", f.label, f.description, f.is_baseline AS "isBaseline", s.is_enabled AS "isEnabled"
    FROM tenant_feature_states s JOIN feature_definitions f ON f.feature_key = s.feature_key
    WHERE s.tenant_id = ${tenantId}
    ORDER BY f.display_order
  `;
}

export async function isFeatureEnabled(tenantId: string, featureKey: FeatureKey) {
  const states = await controlDb<{ isEnabled: boolean }[]>`
    SELECT is_enabled AS "isEnabled" FROM tenant_feature_states
    WHERE tenant_id = ${tenantId} AND feature_key = ${featureKey} LIMIT 1
  `;
  return states[0]?.isEnabled === true;
}

/** Server-only entitlement guard. Navigation visibility never substitutes for this check. */
export async function requireFeature(tenantId: string, featureKey: FeatureKey) {
  if (!await isFeatureEnabled(tenantId, featureKey)) throw new FeatureDisabledError(featureKey);
}

export class FeatureDisabledError extends Error {
  constructor(public readonly featureKey: FeatureKey) {
    super(`The ${featureKey} feature is not enabled for this tenant.`);
    this.name = "FeatureDisabledError";
  }
}
