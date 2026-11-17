/** A staff member may edit their own photo; managers may edit any tenant profile. */
export function canEditStaffPhoto(role: string, ownMemberId: string | null, targetMemberId: string): boolean {
  if (!targetMemberId) return false;
  return role === "owner" || role === "manager" || (role === "staff" && ownMemberId === targetMemberId);
}
