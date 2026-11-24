"use client";

import { useActionState, useState } from "react";
import { saveOwnerProfileName } from "@/app/app/team/actions";

export function OwnerProfileNameForm({ memberId, name }: { memberId: string; name: string }) {
  const [value, setValue] = useState(name);
  const [state, action, pending] = useActionState(saveOwnerProfileName, {});

  return <form action={action} className="staff-profile-form">
    <input type="hidden" name="memberId" value={memberId} />
    <div className="staff-profile-form__grid">
      <label>Name<input name="name" value={value} onChange={(event) => setValue(event.target.value)} maxLength={160} required /></label>
    </div>
    <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save name"}</button>
    {state.error ? <p role="alert">{state.error}</p> : state.saved ? <p role="status">Name saved.</p> : null}
  </form>;
}
