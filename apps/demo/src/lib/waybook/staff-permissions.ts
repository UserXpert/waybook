import "server-only";

import { requireIdentity } from "./auth";
import { tenantDb, type TenantRecord } from "./database";
import type { TenantMembership } from "./tenant-context";

export type StaffPermissionContext = {
  isManager: boolean;
  teamMemberId: string | null;
  canUpdateAppointmentStatus: boolean;
  canManageOwnAppointments: boolean;
  canViewTeamCalendar: boolean;
  canManageTeamAppointments: boolean;
  canManageOwnTimeOff: boolean;
  canManageTeamTimeOff: boolean;
  canManageWaitlist: boolean;
  canViewClients: boolean;
  canManageClients: boolean;
  canAccessReports: boolean;
  canManageResources: boolean;
  canManageServiceSettings: boolean;
};

const denied: Omit<StaffPermissionContext, "isManager" | "teamMemberId"> = {
  canUpdateAppointmentStatus: false,
  canManageOwnAppointments: false,
  canViewTeamCalendar: false,
  canManageTeamAppointments: false,
  canManageOwnTimeOff: false,
  canManageTeamTimeOff: false,
  canManageWaitlist: false,
  canViewClients: false,
  canManageClients: false,
  canAccessReports: false,
  canManageResources: false,
  canManageServiceSettings: false,
};

type ExtendedWorkspacePermissions = Pick<
  StaffPermissionContext,
  | "canViewClients"
  | "canManageClients"
  | "canAccessReports"
  | "canManageResources"
  | "canManageServiceSettings"
>;

type BaseStaffPermissionContext = Omit<
  StaffPermissionContext,
  keyof ExtendedWorkspacePermissions | "isManager"
>;

const deniedWorkspacePermissions: ExtendedWorkspacePermissions = {
  canViewClients: false,
  canManageClients: false,
  canAccessReports: false,
  canManageResources: false,
  canManageServiceSettings: false,
};

/** Allows a rolling upgrade: existing tenant databases keep the proven
 * calendar permission set until migration 0017 is deliberately applied. */
export async function staffWorkspacePermissionsAvailable(tenant: TenantRecord) {
  const db = tenantDb(tenant);
  const [result] = await db<{ count: number }[]>`
    SELECT count(*)::int AS count
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'staff_permissions'
      AND column_name IN (
        'can_view_clients', 'can_manage_clients', 'can_access_reports',
        'can_manage_resources', 'can_manage_service_settings'
      )
  `;
  return result?.count === 5;
}

/** Resolves a signed-in staff member to their tenant profile through the
 * explicit identity link. Never infer this from an email address. */
export async function staffPermissionContext(
  tenant: TenantRecord,
  membership: TenantMembership,
): Promise<StaffPermissionContext> {
  if (["owner", "manager"].includes(membership.role)) {
    return { isManager: true, teamMemberId: null, ...denied };
  }

  const identity = await requireIdentity();
  const db = tenantDb(tenant);
  const [staff] = await db<
    Array<BaseStaffPermissionContext>
  >`
    SELECT tm.id AS "teamMemberId",
      COALESCE(sp.can_update_appointment_status, FALSE) AS "canUpdateAppointmentStatus",
      COALESCE(sp.can_manage_own_appointments, FALSE) AS "canManageOwnAppointments",
      COALESCE(sp.can_view_team_calendar, FALSE) AS "canViewTeamCalendar",
      COALESCE(sp.can_manage_team_appointments, FALSE) AS "canManageTeamAppointments",
      COALESCE(sp.can_manage_own_time_off, FALSE) AS "canManageOwnTimeOff",
      COALESCE(sp.can_manage_team_time_off, FALSE) AS "canManageTeamTimeOff",
      COALESCE(sp.can_manage_waitlist, FALSE) AS "canManageWaitlist"
    FROM team_members tm
    LEFT JOIN staff_permissions sp
      ON sp.tenant_id = tm.tenant_id AND sp.team_member_id = tm.id
    WHERE tm.tenant_id = ${tenant.id}
      AND tm.identity_id = ${identity.id}
      AND tm.is_active = TRUE
    LIMIT 1
  `;
  if (!staff) return { isManager: false, teamMemberId: null, ...denied };
  if (!await staffWorkspacePermissionsAvailable(tenant)) {
    return { isManager: false, ...staff, ...deniedWorkspacePermissions };
  }
  const [workspace] = await db<ExtendedWorkspacePermissions[]>`
    SELECT can_view_clients AS "canViewClients",
      can_manage_clients AS "canManageClients",
      can_access_reports AS "canAccessReports",
      can_manage_resources AS "canManageResources",
      can_manage_service_settings AS "canManageServiceSettings"
    FROM staff_permissions
    WHERE tenant_id = ${tenant.id} AND team_member_id = ${staff.teamMemberId}
    LIMIT 1
  `;
  return { isManager: false, ...staff, ...(workspace ?? deniedWorkspacePermissions) };
}

export function canManageAppointment(
  context: StaffPermissionContext,
  ...teamMemberIds: Array<string | null>
) {
  if (context.isManager || context.canManageTeamAppointments) return true;
  return Boolean(
    context.canManageOwnAppointments &&
      context.teamMemberId &&
      teamMemberIds.length > 0 &&
      teamMemberIds.every((memberId) => memberId === context.teamMemberId),
  );
}

export function canManageTimeOff(
  context: StaffPermissionContext,
  teamMemberId: string,
) {
  return (
    context.isManager ||
    context.canManageTeamTimeOff ||
    Boolean(context.canManageOwnTimeOff && context.teamMemberId === teamMemberId)
  );
}
