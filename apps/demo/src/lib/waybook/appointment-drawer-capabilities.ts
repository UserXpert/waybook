export type AppointmentDrawerCapabilityInput = {
  canManage: boolean;
  canUpdateStatus: boolean;
};

/** Keeps status-only staff from inheriting appointment-management controls. */
export function appointmentDrawerCapabilities(input: AppointmentDrawerCapabilityInput) {
  const canManageAppointment = input.canManage;
  return {
    canUpdateStatus: canManageAppointment || input.canUpdateStatus,
    canEdit: canManageAppointment,
    canReschedule: canManageAppointment,
    canCancel: canManageAppointment,
    canManageResources: canManageAppointment,
    canManagePayments: canManageAppointment,
  };
}
