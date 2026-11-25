import assert from "node:assert/strict";
import test from "node:test";
import { isEmailDeliveryEnabledForTenant } from "./email-delivery-config";

test("a scoped email rollout allows only the configured tenant while delivery is on", () => {
  const scope = { WAYBOOK_EMAIL_DELIVERY_TENANT: "nordic-studio" };
  assert.equal(isEmailDeliveryEnabledForTenant("nordic-studio", scope), false);
  const enabled = { ...scope, WAYBOOK_EMAIL_DELIVERY_ENABLED: "true" };
  assert.equal(isEmailDeliveryEnabledForTenant("nordic-studio", enabled), true);
  assert.equal(isEmailDeliveryEnabledForTenant("copenhagen-physio", enabled), false);
  assert.equal(isEmailDeliveryEnabledForTenant("nordic-studio", { ...enabled, WAYBOOK_EMAIL_DELIVERY_TENANT: "" }), false);
  assert.equal(isEmailDeliveryEnabledForTenant("nordic-studio", { WAYBOOK_EMAIL_DELIVERY_ENABLED: "true" }), true);
});
