/** A read-only membership may retain view permissions, but never write permissions. */
export function enforceReadOnlyPermissions<T extends {
  canUpdateAppointmentStatus: boolean;
  canManageOwnAppointments: boolean;
  canManageTeamAppointments: boolean;
  canManageOwnTimeOff: boolean;
  canManageTeamTimeOff: boolean;
  canManageWaitlist: boolean;
  canManageClients: boolean;
  canManageResources: boolean;
  canManageServiceSettings: boolean;
}>(role: string, permissions: T): T {
  if (role !== "read-only") return permissions;
  return { ...permissions, canUpdateAppointmentStatus: false, canManageOwnAppointments: false, canManageTeamAppointments: false, canManageOwnTimeOff: false, canManageTeamTimeOff: false, canManageWaitlist: false, canManageClients: false, canManageResources: false, canManageServiceSettings: false };
}
