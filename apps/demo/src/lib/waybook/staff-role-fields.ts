export const staffPermissionSections = [{
  title: "Calendar",
  items: [
    ["canUpdateAppointmentStatus", "Can change appointment status", "Confirm, check in, complete, or mark no-shows. Cancellation remains a manager action."],
    ["canManageOwnAppointments", "Can book and change own appointments", "Create, move, and cancel appointments assigned to their own calendar."],
    ["canViewTeamCalendar", "Can view other people’s calendar", "View-only access to colleagues’ schedules."],
    ["canManageTeamAppointments", "Can book and change other people’s appointments", "Create, move, and cancel appointments assigned to other staff members."],
    ["canManageOwnTimeOff", "Can manage own time off", "Add, change, and remove time off on their own schedule."],
    ["canManageTeamTimeOff", "Can manage other people’s time off", "Add, change, and remove time off for other staff members."],
  ],
}, {
  title: "Operations",
  items: [
    ["canManageWaitlist", "Can manage waitlist", "Add, change, and progress waitlist entries."],
    ["canCheckoutAppointments", "Can check out appointments", "Review assigned appointments, record payments received, and finish checkout. Access to other staff appointments requires team calendar and appointment management permissions."],
  ],
}, {
  title: "Clients",
  items: [
    ["canViewClients", "Can access clients", "View client records and contact details."],
    ["canManageClients", "Can create and change clients", "Add and update client records. Deleting, merging, and account balances are not available in Waybook yet."],
  ],
}, {
  title: "Reports",
  items: [["canAccessReports", "Can access business reports", "View business performance and booking health reports."]],
}, {
  title: "Resources",
  items: [["canManageResources", "Can manage resources", "Create and change rooms and equipment used for bookings."]],
}, {
  title: "Setup & management",
  items: [["canManageServiceSettings", "Can manage service settings", "Create and change services, locations, and their booking settings."]],
}] as const;

export type StaffPermissionKey = typeof staffPermissionSections[number]["items"][number][0];
export type StaffRolePermissions = Partial<Record<StaffPermissionKey, boolean>>;
export type StaffRoleOption = { id: string; name: string };
export type StaffRole = StaffRoleOption & { permissions: StaffRolePermissions; assignedCount: number };
export const staffRoleIdPattern = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function parseStaffRolePermissions(form: FormData): StaffRolePermissions {
  return Object.fromEntries(staffPermissionSections.flatMap(({ items }) =>
    items.map(([key]) => [key, form.get(key) === "on"]),
  ));
}
