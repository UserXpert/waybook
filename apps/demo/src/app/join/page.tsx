import Link from "next/link";
import { connection } from "next/server";
import { googleSignInAvailable } from "@/lib/waybook/google-auth";
import { InvitationSignIn } from "./invitation-sign-in";

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ method?: string }> }) {
  await connection();
  const { method } = await searchParams;
  const password = method === "password";
  const available = !password && await googleSignInAvailable();
  return <main className="waybook-login-page">
    <section className={password ? "waybook-login-panel waybook-login-email-join" : "waybook-login-panel"} aria-labelledby="join-title">
      <div className="waybook-login-panel__inner">
        <h1 id="join-title">Join your Waybook workspace</h1>
        {password ? <>
          <p className="waybook-login-intro">Set a password to sign in with your invited work email.</p>
          <InvitationSignIn password />
        </> : available ? <>
          <p className="waybook-login-intro">Use the Google account that matches the work email your workspace owner invited.</p>
          <InvitationSignIn />
        </> : <p role="status">Google sign-in is currently unavailable. Contact your workspace owner for help.</p>}
        <p className="waybook-login-intake__back"><Link href="/login">Back to sign in</Link></p>
      </div>
    </section>
  </main>;
}
