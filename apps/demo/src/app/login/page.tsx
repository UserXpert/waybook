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
        <picture className="waybook-login-brand">
          <source media="(max-width: 760px)" srcSet="/brand/waybook-logo.svg" />
          <img src="/brand/waybook-logo-white.svg" alt="Waybook" />
        </picture>
        <div className="waybook-login-art" aria-hidden="true" />

        <section className="waybook-login-panel" aria-labelledby="login-title">
          <div className="waybook-login-panel__inner">
            <h1 id="login-title">Sign in to Waybook</h1>
            <p className="waybook-login-intro">Use your work account to access your workspace.</p>
            {reset ? <p className="waybook-login-notice" role="status">Password resets are managed by your workspace owner. Ask them to reset your staff access.</p> : null}
            {google === "denied" ? <p className="waybook-login-error" role="alert">Google sign-in could not be completed. Use your invited Google account or ask your workspace owner for a new invitation.</p> : null}
            {google === "unavailable" ? <p className="waybook-login-error" role="alert">Google sign-in is currently unavailable.</p> : null}
            {access === "inactive" ? <p className="waybook-login-error" role="alert">Your staff access is inactive. Ask your workspace owner to restore it.</p> : null}
            {access === "role-pending" ? <p className="waybook-login-error" role="alert">Your workspace role change is pending. Ask your workspace owner to check your access.</p> : null}
            {access === "unavailable" ? <p className="waybook-login-error" role="alert">Your staff profile is unavailable. Ask your workspace owner to check your access.</p> : null}
            <form action={login} className="waybook-login">
              <label>Work email<input name="email" type="email" autoComplete="email" placeholder="you@studio.com" required /></label>
              <div className="waybook-login-password">
                <label>Password<input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></label>
                <a href="/login?reset=1">Forgot password?</a>
              </div>
              {error ? <span className="waybook-login-error" role="alert">Invalid email or password.</span> : null}
              <button type="submit">Sign in</button>
            </form>
            {googleAvailable ? (
              <form action={startGoogleSignIn} className="waybook-login-providers">
                <button type="submit">Continue with Google</button>
              </form>
            ) : null}
          </div>
        </section>
      </section>
    </main>
  );
}
