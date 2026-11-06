import { login } from "./actions";

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { error, reset } = await searchParams;

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
            <form action={login} className="waybook-login">
              <label>Work email<input name="email" type="email" autoComplete="email" placeholder="you@studio.com" required /></label>
              <label><span className="waybook-login-label-row">Password<a href="/login?reset=1">Forgot password?</a></span><input name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required /></label>
              {error ? <span className="waybook-login-error" role="alert">Invalid email or password.</span> : null}
              <button type="submit">Sign in</button>
            </form>
            <div className="waybook-login-divider"><span>or continue with</span></div>
            <div className="waybook-login-providers" aria-describedby="provider-note">
              <button type="button" disabled title="Google sign-in is not configured yet"><b>G</b> Continue with Google</button>
              <button type="button" disabled title="Apple sign-in is not configured yet"><b aria-hidden="true">●</b> Continue with Apple</button>
            </div>
            <p className="waybook-login-provider-note" id="provider-note">Google and Apple sign-in will appear here once your workspace connects them.</p>
          </div>
        </section>
      </section>
    </main>
  );
}
