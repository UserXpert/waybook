import Link from "next/link";
import { connection } from "next/server";
import { googleSignInAvailable } from "@/lib/waybook/google-auth";
import { InvitationSignIn } from "./invitation-sign-in";

export default async function JoinPage() {
  await connection();
  const available = await googleSignInAvailable();
  return <main className="waybook-login-page">
    <section className="waybook-login-panel" aria-labelledby="join-title">
      <div className="waybook-login-panel__inner">
        <h1 id="join-title">Join your Waybook workspace</h1>
        {available ? <>
          <p className="waybook-login-intro">Use the Google account that matches the work email your workspace owner invited.</p>
          <InvitationSignIn />
        </> : <p role="status">Google sign-in is currently unavailable. Contact your workspace owner for help.</p>}
        <Link href="/login">Back to sign in</Link>
      </div>
    </section>
  </main>;
}
