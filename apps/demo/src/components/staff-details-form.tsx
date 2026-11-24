"use client";

import { startTransition, useActionState } from "react";
import type { StaffDetailsState } from "@/app/app/team/actions";

export function StaffDetailsForm({ children, saveLabel, save }: {
  children: React.ReactNode;
  saveLabel: string;
  save: (previous: StaffDetailsState, formData: FormData) => Promise<StaffDetailsState>;
}) {
  const [state, action, pending] = useActionState(save, {});

  return <form action={action} className="staff-profile-form" onSubmit={(event) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  }}>
    {children}
    <button type="submit" disabled={pending}>{pending ? "Saving…" : saveLabel}</button>
    {state.error ? <p role="alert">{state.error}</p> : state.saved ? <p role="status">Details saved.</p> : null}
  </form>;
}
