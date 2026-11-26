"use client";

import { useActionState } from "react";
import { grantStaffAccess } from "@/app/app/team/actions";
import type { StaffAccessRequest } from "@/lib/waybook/staff-access-requests";

export function StaffAccessRequestReview({ request }: { request: StaffAccessRequest }) {
  const [state, action, pending] = useActionState(grantStaffAccess, {});
  return (
    <li>
      <div>
        <strong>{request.name}</strong>
        <span>{request.email} · {request.phone}</span>
      </div>
      {state.sent ? <p role="status">Invitation emailed to {request.email}.</p> : (
        <form action={action}>
          <input name="requestId" type="hidden" value={request.id} />
          <button type="submit" className="waybook-primary-link" disabled={pending}>{pending ? "Emailing invitation…" : "Grant access"}</button>
          {state.error ? <p role="alert">{state.error}</p> : null}
        </form>
      )}
    </li>
  );
}
