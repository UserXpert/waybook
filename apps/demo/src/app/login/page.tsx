import { googleSignInAvailable } from "@/lib/waybook/google-auth";
import { startGoogleSignIn } from "./google-actions";
import { login } from "./actions";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string; google?: string; access?: string }>;
}) {
  const { error, reset, google, access } = await searchParams;
  const googleAvailable = await googleSignInAvailable();

  return (
    <main className="waybook-login-page">
      <section className="waybook-login-shell">
        <aside className="waybook-login-showcase" aria-label="Waybook product preview">
          <div className="waybook-login-backgrounds" aria-hidden="true">
            <span className="is-background-one" />
            <span className="is-background-two" />
            <span className="is-background-four" />
          </div>
          <img className="waybook-login-logo" src="/brand/waybook-logo.svg" alt="Waybook" />
          <div className="waybook-login-orbit" aria-hidden="true" />
          <div className="waybook-login-widget">
            <div className="waybook-login-widget__header"><span>Today at Nordic Studio</span><b>Live schedule</b></div>
            <div className="waybook-login-widget__metric"><strong>12</strong><span>appointments in motion</span><em>+3 confirmed</em></div>
            <div className="waybook-login-widget__booking"><i>AC</i><span><b>Avery Chen</b><small>10:00 · Private session</small></span><em>Confirmed</em></div>
            <div className="waybook-login-widget__booking"><i>SA</i><span><b>Sofie Andersen</b><small>10:30 · Studio session</small></span><em>Ready</em></div>
            <div className="waybook-login-widget__progress"><span /></div>
          </div>
          <div className="waybook-login-showcase__footer"><p>Clear days. Calm teams.</p><span>Manage bookings, staff and studio resources in one place.</span></div>
        </aside>

        <section className="waybook-login-panel" aria-labelledby="login-title">
          <div className="waybook-login-panel__inner">
            <img className="waybook-login-mobile-logo" src="/brand/waybook-logo.svg" alt="Waybook" />
            <p className="waybook-login-eyebrow">WELCOME BACK</p>
            <h1 id="login-title">Sign in to Waybook</h1>
            <p className="waybook-login-intro">Your studio day is ready when you are.</p>
            {reset ? <p className="waybook-login-notice" role="status">Password resets are managed by your workspace owner. Ask them to reset your staff access.</p> : null}
            {google === "denied" ? <p className="waybook-login-error" role="alert">Google sign-in could not be completed. Use your invited Google account or ask your workspace owner for a new invitation.</p> : null}
            {google === "unavailable" ? <p className="waybook-login-error" role="alert">Google sign-in is currently unavailable.</p> : null}
            {access === "inactive" ? <p className="waybook-login-error" role="alert">Your staff access is inactive. Ask your workspace owner to restore it.</p> : null}
            {access === "role-pending" ? <p className="waybook-login-error" role="alert">Your workspace role change is pending. Ask your workspace owner to check your access.</p> : null}
            {access === "unavailable" ? <p className="waybook-login-error" role="alert">Your staff profile is unavailable. Ask your workspace owner to check your access.</p> : null}
            <form action={login} className="waybook-login">
              <label>Work email<input name="email" type="email" autoComplete="email" placeholder="you@studio.com" required /></label>
              <label><span className="waybook-login-label-row">Password<a href="/login?reset=1">Forgot password?</a></span><input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></label>
              {error ? <span className="waybook-login-error" role="alert">Invalid email or password.</span> : null}
              <button type="submit">Sign in</button>
            </form>
            {googleAvailable ? <>
              <div className="waybook-login-divider"><span>or continue with</span></div>
              <form action={startGoogleSignIn} className="waybook-login-providers">
                <button type="submit">Continue with Google</button>
              </form>
            </> : null}
          </div>
        </section>
      </section>
    </main>
  );
}
