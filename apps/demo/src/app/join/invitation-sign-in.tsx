"use client";

import { useEffect, useState } from "react";
import { startGoogleSignIn } from "../login/google-actions";

export function InvitationSignIn() {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => setToken(window.location.hash.slice(1)), []);

  if (token === null) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    return <p className="waybook-login-error" role="alert">This invitation link is incomplete. Ask your workspace owner for a new link.</p>;
  }
  return <form action={startGoogleSignIn} className="waybook-login">
    <input type="hidden" name="invite" value={token} />
    <button type="submit">Continue with Google</button>
  </form>;
}
