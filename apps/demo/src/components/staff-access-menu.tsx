"use client";

import { ArchiveRestore, KeyRound, Link2, MoreHorizontal, RotateCcw, UserRoundCheck, UserRoundX } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { cancelStaffGoogleInvitation, createStaffGoogleInvitation, provisionStaffLogin, resetStaffPassword, setStaffLifecycle } from "@/app/app/team/actions";
import { showSuccessToast } from "@/lib/waybook/toast";

type StaffAccessMenuProps = {
  memberId: string;
  name: string;
  isActive: boolean;
  hasLogin: boolean;
  canManage: boolean;
  isOwner: boolean;
  isArchived: boolean;
  archiveAvailable: boolean;
  canInviteWithGoogle: boolean;
  canManagePassword: boolean;
};

export function StaffAccessMenu({ memberId, name, isActive, hasLogin, canManage, isOwner, isArchived, archiveAvailable, canInviteWithGoogle, canManagePassword }: StaffAccessMenuProps) {
  const [panel, setPanel] = useState<"password" | "google" | null>(null);
  const [invitation, setInvitation] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [isPending, startTransition] = useTransition();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  if (!canManage) return null;
  const credentialAction = hasLogin ? resetStaffPassword : provisionStaffLogin;
  const credentialLabel = hasLogin ? "Change password" : "Create login";
  const lifecycleAction = async (formData: FormData) => { await setStaffLifecycle(formData); showSuccessToast("Staff access updated."); };
  const saveCredentials = async (formData: FormData) => { await credentialAction(formData); showSuccessToast(hasLogin ? "Staff password changed." : "Staff login created."); };

  const invitationAction = (action: "create" | "revoke") => {
    setInvitationError("");
    const form = new FormData();
    form.set("memberId", memberId);
    startTransition(async () => {
      try {
        if (action === "create") {
          setInvitation(await createStaffGoogleInvitation(form));
        } else {
          await cancelStaffGoogleInvitation(form);
          setInvitation("");
          showSuccessToast("Pending invitation revoked.");
        }
      } catch {
        setInvitationError("Could not update the invitation. Check the staff member’s work email and access.");
      }
    });
  };

  return <div className="staff-access-menu">
    <details ref={detailsRef}>
      <summary aria-label={`Actions for ${name}`}><MoreHorizontal size={18} aria-hidden="true" /></summary>
      <div className="staff-access-menu__popover">
        {isArchived ? <form action={lifecycleAction}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="restore" /><button type="submit"><RotateCcw size={16} aria-hidden="true" />Restore</button></form> : isActive ? <form action={lifecycleAction}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="deactivate" /><button type="submit"><UserRoundX size={16} aria-hidden="true" />Deactivate</button></form> : <form action={lifecycleAction}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="reactivate" /><button type="submit"><UserRoundCheck size={16} aria-hidden="true" />Reactivate</button></form>}
        {isOwner && isActive && archiveAvailable ? <form action={lifecycleAction}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="archive" /><button type="submit"><ArchiveRestore size={16} aria-hidden="true" />Archive</button></form> : null}
        {canInviteWithGoogle ? <button type="button" onClick={() => { detailsRef.current?.removeAttribute("open"); setPanel("google"); }}><Link2 size={16} aria-hidden="true" />Google invitation</button> : null}
        {isOwner && !isArchived && canManagePassword ? <button type="button" onClick={() => { detailsRef.current?.removeAttribute("open"); setPanel((open) => open === "password" ? null : "password"); }}><KeyRound size={16} aria-hidden="true" />{credentialLabel}</button> : null}
      </div>
    </details>
    {panel === "password" ? <form action={saveCredentials} className="staff-access-menu__credentials">
      <input type="hidden" name="memberId" value={memberId} />
      <p><b>{credentialLabel}</b><span>{hasLogin ? "Setting a new password signs this person out of every current session." : "Set a temporary password and share it through a secure channel."}</span></p>
      <label>Temporary password<input type="password" name="password" autoComplete="new-password" minLength={12} required /></label>
      <label>Confirm password<input type="password" name="passwordConfirmation" autoComplete="new-password" minLength={12} required /></label>
      <div><button type="submit">{credentialLabel}</button><button type="button" onClick={() => setPanel(null)}>Cancel</button></div>
    </form> : null}
    {panel === "google" ? <section className="staff-access-menu__credentials" aria-label="Google invitation">
      <p><b>Google invitation</b><span>Share the link with this staff member. It expires in 48 hours. Creating a new link revokes the previous pending link.</span></p>
      {invitation ? <label>Invitation link<input readOnly value={invitation} onFocus={(event) => event.target.select()} /></label> : null}
      {invitationError ? <p role="alert">{invitationError}</p> : null}
      <div>
        {invitation ? <button type="button" disabled={isPending} onClick={async () => {
          try { await navigator.clipboard.writeText(invitation); showSuccessToast("Invitation link copied."); }
          catch { setInvitationError("Select the invitation link and copy it manually."); }
        }}>Copy link</button> : <button type="button" disabled={isPending} onClick={() => invitationAction("create")}>Create link</button>}
        <button type="button" disabled={isPending} onClick={() => invitationAction("revoke")}>Revoke pending link</button>
        <button type="button" disabled={isPending} onClick={() => { setPanel(null); setInvitation(""); setInvitationError(""); }}>Close</button>
      </div>
    </section> : null}
  </div>;
}
