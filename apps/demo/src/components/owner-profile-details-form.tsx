"use client";

import { useActionState } from "react";
import { saveOwnerProfileDetails } from "@/app/app/team/actions";

export function OwnerProfileDetailsForm({ children, saveLabel }: { children: React.ReactNode; saveLabel: string }) {
  const [state, action, pending] = useActionState(saveOwnerProfileDetails, {});

  return <form action={action} className="staff-profile-form">
    {children}
    <button type="submit" disabled={pending}>{pending ? "Saving…" : saveLabel}</button>
    {state.error ? <p role="alert">{state.error}</p> : state.saved ? <p role="status">Details saved.</p> : null}
  </form>;
}
