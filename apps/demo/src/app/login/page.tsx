import { headers } from "next/headers";
import { parseBookingPage, publicBookingImageUrl } from "@/lib/waybook/booking-page-media";
import { tenantDb } from "@/lib/waybook/database";
import { googleSignInAvailable } from "@/lib/waybook/google-auth";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";
import { loginPathForTenant } from "@/lib/waybook/tenant-routes";
import { ClientLogo } from "./client-logo";
import { startGoogleSignIn } from "./google-actions";
import { login } from "./actions";
import { PasswordField } from "./password-field";
import { FeatureMessages } from "./feature-messages";

async function getClientBranding(requestHeaders: Headers) {
  const tenant = await tenantForPublicRequest(requestHeaders).catch(() => null);
  if (!tenant) return null;

  try {
    const [settings] = await tenantDb(tenant)<{ bookingPage: { logoUrl?: unknown } | string | null }[]>`
      SELECT booking_page AS "bookingPage"
      FROM tenant_settings WHERE tenant_id = ${tenant.id} LIMIT 1
    `;
    const src = publicBookingImageUrl(parseBookingPage(settings?.bookingPage).logoUrl);
    return { src, name: tenant.name };
  } catch {
    return { src: undefined, name: tenant.name };
  }
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string; google?: string; access?: string }>;
}) {
  const requestHeaders = await headers();
  const [{ error, reset, google, access }, clientBranding, googleAvailable] = await Promise.all([
    searchParams, getClientBranding(requestHeaders), googleSignInAvailable(),
  ]);
  const loginPath = loginPathForTenant(requestHeaders.get("x-waybook-tenant-route"));

  return (
    <main className="waybook-login-page">
      <section className="waybook-login-shell">
        <img className="waybook-login-brand" src="/brand/waybook-logo.svg" alt="Waybook" />

        <section className="waybook-login-panel" aria-labelledby="login-title">
          {clientBranding?.src ? <ClientLogo src={clientBranding.src} name={clientBranding.name} /> : null}
          <div className="waybook-login-panel__inner">
            <h1 id="login-title">{clientBranding ? "Welcome back" : "Sign in to Waybook"}</h1>
            <p className="waybook-login-intro">Use your work account to access your workspace.</p>
            {reset ? <p className="waybook-login-notice" role="status">Password resets are managed by your workspace owner. Ask them to reset your staff access.</p> : null}
            {google === "denied" ? <p className="waybook-login-error" role="alert">Google sign-in could not be completed. Use your invited Google account or ask your workspace owner for a new invitation.</p> : null}
            {google === "unavailable" ? <p className="waybook-login-error" role="alert">Google sign-in is currently unavailable.</p> : null}
            {access === "inactive" ? <p className="waybook-login-error" role="alert">Your staff access is inactive. Ask your workspace owner to restore it.</p> : null}
            {access === "role-pending" ? <p className="waybook-login-error" role="alert">Your workspace role change is pending. Ask your workspace owner to check your access.</p> : null}
            {access === "unavailable" ? <p className="waybook-login-error" role="alert">Your staff profile is unavailable. Ask your workspace owner to check your access.</p> : null}
            <form action={login} className="waybook-login">
              <label>Work email<input name="email" type="email" autoComplete="email" placeholder="you@studio.com" required /></label>
              <PasswordField />
              <div className="waybook-login-options">
                <label><input name="rememberMe" type="checkbox" />Remember me</label>
                <a href={`${loginPath}?reset=1`}>Forgot password?</a>
              </div>
              {error ? <span className="waybook-login-error" role="alert">Invalid email or password.</span> : null}
              <button type="submit">Sign in</button>
            </form>
            {googleAvailable ? (
              <form action={startGoogleSignIn} className="waybook-login-providers">
                <button type="submit">
                  <img src="/brand/google-g.png" width="18" height="18" alt="" />
                  Continue with Google
                </button>
              </form>
            ) : null}
          </div>
          <p className="waybook-login-signup">
            New business? <a href="https://waybook-website.vercel.app/en#venteliste">{clientBranding ? "Request access" : "Sign up for early access"}</a>
          </p>
        </section>

        <aside className="waybook-login-art" aria-label="Waybook product preview">
          <div className="waybook-login-schedule">
            <div className="waybook-login-schedule__header">
              <strong>Today at Nordic Studio</strong>
              <span>Schedule preview</span>
            </div>
            <div className="waybook-login-schedule__total">
              <strong>12</strong>
              <span>appointments in motion</span>
              <b>+3 confirmed</b>
            </div>
            <ul className="waybook-login-schedule__bookings">
              <li>
                <span className="waybook-login-schedule__initials" aria-hidden="true">AC</span>
                <span><strong>Avery Chen</strong><small>10:00 · Private session</small></span>
                <b>Confirmed</b>
              </li>
              <li>
                <span className="waybook-login-schedule__initials" aria-hidden="true">SA</span>
                <span><strong>Sofie Andersen</strong><small>10:30 · Studio session</small></span>
                <b>Ready</b>
              </li>
            </ul>
            <div className="waybook-login-schedule__bar" aria-hidden="true" />
          </div>
          <FeatureMessages />
        </aside>
      </section>
      <footer className="waybook-login-copyright">
        <small>© {new Date().getUTCFullYear()} Waybook</small>
      </footer>
    </main>
  );
}
