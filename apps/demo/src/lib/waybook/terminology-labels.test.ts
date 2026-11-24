import assert from "node:assert/strict";
import test from "node:test";
import { defaultTenantTerminology, isClientTerm, isStaffTerm, terminologyLabels, titleTerminology } from "./terminology-labels";

test("missing or unexpected terminology uses existing labels", () => {
  assert.deepEqual(terminologyLabels(null, "custom-provider"), defaultTenantTerminology);
  assert.equal(isClientTerm("Patient"), false);
  assert.equal(isStaffTerm("patient"), false);
});

test("clients and staff can adopt clinical terms independently", () => {
  assert.equal(terminologyLabels("patient", "staff").clients, "patients");
  assert.equal(terminologyLabels("patient", "staff").staffMember, "staff member");
  assert.equal(terminologyLabels("client", "practitioner").client, "client");
  assert.equal(titleTerminology(terminologyLabels("client", "practitioner").staffPlural), "Practitioners");
});
