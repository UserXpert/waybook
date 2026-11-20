import assert from "node:assert/strict";
import test from "node:test";
import { appointmentDrawerCapabilities } from "./appointment-drawer-capabilities.ts";

test("status-only staff can update status without appointment-management controls", () => {
  assert.deepEqual(
    appointmentDrawerCapabilities({ canManage: false, canUpdateStatus: true }),
    {
      canUpdateStatus: true,
      canEdit: false,
      canReschedule: false,
      canCancel: false,
      canManageResources: false,
      canManagePayments: false,
    },
  );
});

test("managers retain all appointment drawer controls", () => {
  const capabilities = appointmentDrawerCapabilities({ canManage: true, canUpdateStatus: false });
  assert.ok(Object.values(capabilities).every(Boolean));
});
