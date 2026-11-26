"use client";

import { useActionState, useState } from "react";
import { grantStaffAccess } from "@/app/app/team/actions";
import type { StaffAccessRequest } from "@/lib/waybook/staff-access-requests";

export function StaffAccessRequestReview({ request }: { request: StaffAccessRequest }) {
  const [state, action, pending] = useActionState(grantStaffAccess, {});
  const [copied, setCopied] = useState(false);
  return (
    <li>
      <div>
        <strong>{request.name}</strong>
        <span>{request.email} · {request.phone}</span>
      </div>
      {state.invitation ? (
        <div className="staff-access-requests__invitation">
          <p role="status">{copied ? "Invitation link copied." : "Invitation ready. Share it with this staff member."}</p>
          <label>Invitation link<input readOnly value={state.invitation} onFocus={event => event.currentTarget.select()} /></label>
          <button type="button" className="waybook-row-link" onClick={async () => {
            try {
              await navigator.clipboard.writeText(state.invitation!);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}>Copy invitation link</button>
        </div>
      ) : (
        <form action={action}>
          <input name="requestId" type="hidden" value={request.id} />
          <button type="submit" className="waybook-primary-link" disabled={pending}>{pending ? "Creating invitation…" : "Grant access"}</button>
          {state.error ? <p role="alert">{state.error}</p> : null}
        </form>
      )}
    </li>
  );
}
