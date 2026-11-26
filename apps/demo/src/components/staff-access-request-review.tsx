"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { reviewStaffAccess } from "@/app/app/team/actions";
import { TenantEditorDialog } from "@/components/tenant-editor-dialog";
import type { OutstandingStaffAccessRequest } from "@/lib/waybook/staff-access-requests";

const statusLabels = { pending: "Pending approval", invited: "Invitation sent", expired: "Invitation expired" };

export function StaffAccessRequestPanel({ requests }: { requests: OutstandingStaffAccessRequest[] }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const refresh = () => router.refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [open, router]);

  function close() {
    setOpen(false);
    requestAnimationFrame(() => opener.current?.focus());
  }

  return (
    <>
      <section className="waybook-data-card staff-access-requests__summary" aria-label="Staff access requests">
        <h2>Staff access requests ({requests.length})</h2>
        <button ref={opener} className="waybook-action waybook-action--secondary" type="button" aria-haspopup="dialog" onClick={() => {
          setOpen(true);
          router.refresh();
        }}>See requests</button>
      </section>
      {open ? (
        <TenantEditorDialog title="Staff access requests" onDismiss={close} cycleFocus>
          <aside className="tenant-drawer staff-access-requests">
            <header>
              <div>
                <h2>Staff access requests</h2>
                <span>Review requests and manage invitations that haven’t been claimed.</span>
              </div>
              <button type="button" className="tenant-drawer-close" aria-label="Close staff access requests" onClick={close}>Close</button>
            </header>
            {requests.length ? (
              <ul>
                {requests.map(request => <StaffAccessRequestReview key={request.id} request={request} />)}
              </ul>
            ) : <p className="staff-access-requests__empty">No outstanding requests.</p>}
          </aside>
        </TenantEditorDialog>
      ) : null}
    </>
  );
}

function StaffAccessRequestReview({ request }: { request: OutstandingStaffAccessRequest }) {
  const [state, action, pending] = useActionState(reviewStaffAccess, {});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const invited = request.status !== "pending";

  useEffect(() => {
    if (state.sent || state.deleted) router.refresh();
  }, [state, router]);

  useEffect(() => {
    if (confirmDelete) confirmButton.current?.focus();
  }, [confirmDelete]);

  if (state.deleted) return null;
  return (
    <li>
      <div>
        <strong>{request.name}</strong>
        <span>{request.email} · {request.phone}</span>
        <small>{statusLabels[request.status]}</small>
      </div>
      <form action={action}>
        <input name="requestId" type="hidden" value={request.id} />
        <input name="sendNumber" type="hidden" value={request.sendNumber} />
        {confirmDelete ? (
          <>
            <p>Delete this request{invited ? " and revoke its invitation" : ""}?</p>
            <div className="staff-access-requests__actions">
              <button ref={confirmButton} type="submit" name="intent" value="delete" disabled={pending} className="waybook-action waybook-action--danger">Confirm delete</button>
              <button type="button" className="waybook-action waybook-action--secondary" disabled={pending} onClick={() => {
                setConfirmDelete(false);
                requestAnimationFrame(() => deleteButton.current?.focus());
              }}>Cancel</button>
            </div>
          </>
        ) : (
          <div className="staff-access-requests__actions">
            <button type="submit" name="intent" value={invited ? "resend" : "grant"} disabled={pending} className={invited ? "waybook-action waybook-action--secondary" : "waybook-action"}>
              {pending ? "Emailing invitation…" : invited ? "Resend invitation" : "Grant access"}
            </button>
            <button ref={deleteButton} type="button" className="waybook-action waybook-action--secondary" disabled={pending} onClick={() => setConfirmDelete(true)}>Delete request</button>
          </div>
        )}
        {!pending && state.error ? <p className="waybook-feedback waybook-feedback--error" role="alert">{state.error}</p> : null}
        {!pending && state.sent ? <p className="waybook-feedback waybook-feedback--success" role="status">Invitation emailed to {request.email}.</p> : null}
      </form>
    </li>
  );
}
