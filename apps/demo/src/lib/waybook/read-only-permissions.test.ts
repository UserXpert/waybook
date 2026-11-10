import assert from "node:assert/strict";
import test from "node:test";
import { enforceReadOnlyPermissions } from "./read-only-permissions.ts";

test("read-only role cannot retain write permissions after a role change", () => {
  const previouslyGranted = {
    canUpdateAppointmentStatus: true, canManageOwnAppointments: true,
    canManageTeamAppointments: true, canManageOwnTimeOff: true,
    canManageTeamTimeOff: true, canManageWaitlist: true,
    canManageClients: true, canManageResources: true,
    canManageServiceSettings: true, canViewTeamCalendar: true,
    canViewClients: true, canAccessReports: true,
  };
  const readonly = enforceReadOnlyPermissions("read-only", previouslyGranted);
  for (const key of Object.keys(readonly) as Array<keyof typeof readonly>) {
    assert.equal(readonly[key], ["canViewTeamCalendar", "canViewClients", "canAccessReports"].includes(key), key);
  }
  assert.deepEqual(enforceReadOnlyPermissions("staff", previouslyGranted), previouslyGranted);
});
