"use client";

import { ArchiveRestore, KeyRound, Link2, MoreHorizontal, RotateCcw, Trash2, UserRoundCheck, UserRoundX } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { cancelStaffGoogleInvitation, createStaffGoogleInvitation, deleteStaffProfile, provisionStaffLogin, resetStaffPassword, setStaffLifecycle } from "@/app/app/team/actions";
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
  canDelete: boolean;
  canInviteWithGoogle: boolean;
  canManagePassword: boolean;
};

export function StaffAccessMenu({ memberId, name, isActive, hasLogin, canManage, isOwner, isArchived, archiveAvailable, canDelete, canInviteWithGoogle, canManagePassword }: StaffAccessMenuProps) {
  const [panel, setPanel] = useState<"password" | "google" | "delete" | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [invitation, setInvitation] = useState("");
  const [invitationError, setInvitationError] = useState("");
  const [isPending, startTransition] = useTransition();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const deleteCancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!canManage) return;
    function dismissOutside(event: PointerEvent) {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false;
    }
    function dismissOnEscape(event: KeyboardEvent) {
      const details = detailsRef.current;
      if (event.key !== "Escape" || event.defaultPrevented || !details?.open) return;
      details.open = false;
      if (details.contains(document.activeElement)) summaryRef.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [canManage]);
  useEffect(() => {
    if (panel === "delete") deleteCancelRef.current?.focus();
  }, [panel]);
  if (!canManage) return null;
  const credentialAction = hasLogin ? resetStaffPassword : provisionStaffLogin;
  const credentialLabel = hasLogin ? "Change password" : "Create login";
  const lifecycleAction = async (formData: FormData) => {
    detailsRef.current?.removeAttribute("open");
    await setStaffLifecycle(formData);
    showSuccessToast("Staff access updated.");
  };
  const saveCredentials = async (formData: FormData) => { await credentialAction(formData); showSuccessToast(hasLogin ? "Staff password changed." : "Staff login created."); };

  function cancelDelete() {
    setPanel(null);
    summaryRef.current?.focus();
  }

  function confirmDelete(formData: FormData) {
    setDeleteError("");
    startTransition(async () => {
      try {
        const result = await deleteStaffProfile(formData);
        if (result.error) setDeleteError(result.error);
        else {
          setPanel(null);
          showSuccessToast("Staff profile deleted.");
        }
      } catch {
        setDeleteError("Could not delete this staff profile. Refresh and try again.");
      }
    });
  }

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
      <summary ref={summaryRef} aria-label={`Actions for ${name}`} onClick={() => {
        if (panel === "delete" && !isPending) setPanel(null);
      }}><MoreHorizontal size={18} aria-hidden="true" /></summary>
      <div className="staff-access-menu__popover">
        {isArchived ? <form action={lifecycleAction}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="restore" /><button type="submit"><RotateCcw size={16} aria-hidden="true" />Restore</button></form> : isActive ? <form action={lifecycleAction}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="deactivate" /><button type="submit"><UserRoundX size={16} aria-hidden="true" />Deactivate</button></form> : <form action={lifecycleAction}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="reactivate" /><button type="submit"><UserRoundCheck size={16} aria-hidden="true" />Reactivate</button></form>}
        {isOwner && isActive && archiveAvailable ? <form action={lifecycleAction}><input type="hidden" name="memberId" value={memberId} /><input type="hidden" name="action" value="archive" /><button type="submit"><ArchiveRestore size={16} aria-hidden="true" />Archive</button></form> : null}
        {canInviteWithGoogle ? <button type="button" onClick={() => { detailsRef.current?.removeAttribute("open"); setPanel("google"); }}><Link2 size={16} aria-hidden="true" />Google invitation</button> : null}
        {isOwner && !isArchived && canManagePassword ? <button type="button" onClick={() => { detailsRef.current?.removeAttribute("open"); setPanel((open) => open === "password" ? null : "password"); }}><KeyRound size={16} aria-hidden="true" />{credentialLabel}</button> : null}
        {canDelete ? <button type="button" onClick={() => {
          detailsRef.current?.removeAttribute("open");
          setDeleteError("");
          setPanel("delete");
        }}><Trash2 size={16} aria-hidden="true" />Delete</button> : null}
      </div>
    </details>
    {canDelete && panel === "delete" ? <form action={confirmDelete} className="staff-access-menu__credentials" aria-label="Delete staff profile" onKeyDown={(event) => {
      if (event.key === "Escape" && !isPending) {
        event.preventDefault();
        cancelDelete();
      }
    }}>
      <input type="hidden" name="memberId" value={memberId} />
      <p><b>Delete {name}?</b><span>This removes the profile from the staff directory. Booking history is kept.</span></p>
      {deleteError ? <p role="alert" className="waybook-feedback waybook-feedback--error">{deleteError}</p> : null}
      <div>
        <button type="submit" className="waybook-action waybook-action--danger" disabled={isPending}>Delete profile</button>
        <button ref={deleteCancelRef} type="button" className="waybook-action waybook-action--secondary" disabled={isPending} onClick={cancelDelete}>Cancel</button>
      </div>
    </form> : null}
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
