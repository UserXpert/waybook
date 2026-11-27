import "server-only";
import type { Sql } from "postgres";
import type { StaffPermissionContext } from "./staff-permissions";

/** Apply to the bookings alias b, alongside the caller's tenant predicate. */
export function appointmentCheckoutAccess(db: Sql, permissions: StaffPermissionContext) {
  if (permissions.isManager) return db`TRUE`;
  if (!permissions.canCheckoutAppointments || !permissions.teamMemberId) return db`FALSE`;
  if (permissions.canViewTeamCalendar && permissions.canManageTeamAppointments) return db`TRUE`;
  return db`b.team_member_id IS NOT DISTINCT FROM ${permissions.teamMemberId}::uuid
    AND NOT EXISTS (
      SELECT 1 FROM booking_service_segments segment
      JOIN booking_blocks block ON block.tenant_id = segment.tenant_id AND block.id = segment.booking_block_id
      WHERE segment.tenant_id = b.tenant_id AND segment.booking_id = b.id
        AND block.team_member_id IS DISTINCT FROM ${permissions.teamMemberId}::uuid
    )`;
}
