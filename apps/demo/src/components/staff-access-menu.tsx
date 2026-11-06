"use client";

import { ArchiveRestore, KeyRound, MoreHorizontal, RotateCcw, UserRoundCheck, UserRoundX } from "lucide-react";
import { useRef, useState } from "react";
import { provisionStaffLogin, resetStaffPassword, setStaffLifecycle } from "@/app/app/team/actions";

type StaffAccessMenuProps = {
  memberId: string;
  name: string;
  isActive: boolean;
  hasLogin: boolean;
  canManage: boolean;
  isOwner: boolean;
  isArchived: boolean;
  archiveAvailable: boolean;
};

export function StaffAccessMenu({ memberId, name, isActive, hasLogin, canManage, isOwner, isArchived, archiveAvailable }: StaffAccessMenuProps) {
  const [showCredentials, setShowCredentials] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  if (!canManage) return null;
  const credentialAction = hasLogin ? resetStaffPassword : provisionStaffLogin;
  const credentialLabel = hasLogin ? "Change password" : "Create login";

  return <div className="staff-access-menu">
    <details ref={detailsRef}>
      <summary aria-label={`Actions for ${name}`}><MoreHorizontal size={18} aria-hidden="true" /></summary>
      <div className="staff-access-menu__popover">
        {isArchived ? <form action={setStaffLifecycle}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="restore" /><button type="submit"><RotateCcw size={16} aria-hidden="true" />Restore</button></form> : isActive ? <form action={setStaffLifecycle}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="deactivate" /><button type="submit"><UserRoundX size={16} aria-hidden="true" />Deactivate</button></form> : <form action={setStaffLifecycle}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="reactivate" /><button type="submit"><UserRoundCheck size={16} aria-hidden="true" />Reactivate</button></form>}
        {isOwner && isActive && archiveAvailable ? <form action={setStaffLifecycle}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="archive" /><button type="submit"><ArchiveRestore size={16} aria-hidden="true" />Archive</button></form> : null}
        {isOwner && !isArchived ? <button type="button" onClick={() => { detailsRef.current?.removeAttribute("open"); setShowCredentials((open) => !open); }}><KeyRound size={16} aria-hidden="true" />{credentialLabel}</button> : null}
      </div>
    </details>
    {showCredentials ? <form action={credentialAction} className="staff-access-menu__credentials">
      <input type="hidden" name="memberId" value={memberId} />
      <p><b>{credentialLabel}</b><span>{hasLogin ? "Setting a new password signs this person out of every current session." : "Set a temporary password and share it through a secure channel."}</span></p>
      <label>Temporary password<input type="password" name="password" autoComplete="new-password" minLength={12} required /></label>
      <label>Confirm password<input type="password" name="passwordConfirmation" autoComplete="new-password" minLength={12} required /></label>
      <div><button type="submit">{credentialLabel}</button><button type="button" onClick={() => setShowCredentials(false)}>Cancel</button></div>
    </form> : null}
  </div>;
}
