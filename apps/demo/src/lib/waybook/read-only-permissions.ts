const readOnlyWritePermissions = {
  canUpdateAppointmentStatus: false,
  canManageOwnAppointments: false,
  canManageTeamAppointments: false,
  canManageOwnTimeOff: false,
  canManageTeamTimeOff: false,
  canManageWaitlist: false,
  canCheckoutAppointments: false,
  canManageClients: false,
  canManageResources: false,
  canManageServiceSettings: false,
};

export function canConfigureStaffPermission(role: string, permission: string) {
  return role !== "read-only" || !Object.hasOwn(readOnlyWritePermissions, permission);
}

/** A read-only membership may retain view permissions, but never write permissions. */
export function enforceReadOnlyPermissions<T extends Record<keyof typeof readOnlyWritePermissions, boolean>>(role: string, permissions: T): T {
  if (role !== "read-only") return permissions;
  return { ...permissions, ...readOnlyWritePermissions };
}
