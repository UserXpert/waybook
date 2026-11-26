"use client";

import { useActionState, useEffect, useState } from "react";
import { startGoogleSignIn } from "../login/google-actions";
import { acceptEmailInvitation } from "./actions";

export function InvitationSignIn({ password = false }: { password?: boolean }) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    const readToken = () => setToken(window.location.hash.slice(1));
    readToken();
    window.addEventListener("hashchange", readToken);
    return () => window.removeEventListener("hashchange", readToken);
  }, []);

  if (token === null) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return <p className="waybook-login-error" role="alert">This invitation link is incomplete. Ask your workspace owner for a new link.</p>;
  }
  if (password) return <InvitationPasswordForm key={token} token={token} />;
  return <form action={startGoogleSignIn} className="waybook-login">
    <input type="hidden" name="invite" value={token} />
    <button type="submit">Continue with Google</button>
  </form>;
}

function InvitationPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(acceptEmailInvitation, {});
  return (
    <form action={action} className="waybook-login">
      <input type="hidden" name="invite" value={token} />
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      <label>Confirm password<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
      {state.error ? <p role="alert" className="waybook-login-error">{state.error}</p> : null}
      <button type="submit" disabled={pending}>{pending ? "Activating…" : "Set password and sign in"}</button>
    </form>
  );
}
