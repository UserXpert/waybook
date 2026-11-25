export type AppointmentDrawerCapabilityInput = {
  canManage: boolean;
  canManageSchedule?: boolean;
  canUpdateStatus: boolean;
};

export function appointmentDrawerCapabilities(input: AppointmentDrawerCapabilityInput) {
  const canManageAppointment = input.canManage;
  const canManageSchedule = canManageAppointment || Boolean(input.canManageSchedule);
  return {
    canUpdateStatus: canManageAppointment || input.canUpdateStatus,
    canEdit: canManageAppointment,
    canReschedule: canManageSchedule,
    canCancel: canManageSchedule,
    canManageResources: canManageAppointment,
    canManagePayments: canManageAppointment,
  };
}
