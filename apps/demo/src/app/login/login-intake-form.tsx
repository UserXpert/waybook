"use client";

import { useActionState } from "react";
import { joinBusinessWaitlist, requestStaffAccess } from "./intake-actions";

const categories = ["Salons and beauty", "Trades and services", "Restaurants and cafés", "Clinics and treatments", "Other"];

export function LoginIntakeForm({ staff, loginPath }: { staff: boolean; loginPath: string }) {
  const [state, action, pending] = useActionState(staff ? requestStaffAccess : joinBusinessWaitlist, {});
  const confirmation = staff
    ? state.invitationSent ? "Your invitation has been emailed. Check your work inbox and spam folder for the link."
      : "Request received. If you’ve already been invited, check your work inbox and spam folder."
    : "You’re on the waitlist. We’ll contact you about early access.";
  return (
    <>
      <h1 id="login-title">{staff ? "Request staff access" : "Sign up for early access"}</h1>
      <p className="waybook-login-intro">
        {staff ? state.invitationSent ? "Your workspace owner approved your request."
          : "Your workspace owner will review your request." : "Join the waitlist for your business."}
      </p>
      {state.submitted ? (
        <p className="waybook-login-notice" role="status">
          {confirmation}
        </p>
      ) : (
        <form action={action} className="waybook-login waybook-login-intake">
          {staff ? <label>Full name<input name="name" autoComplete="name" maxLength={160} required /></label>
            : <label>Business name<input name="business" autoComplete="organization" maxLength={160} required /></label>}
          <label>Work email<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          {staff ? <label>Phone number<input name="phone" type="tel" autoComplete="tel" maxLength={40} required /></label> : (
            <>
              <label>Business type
                <select name="category" defaultValue="" required>
                  <option value="" disabled>Choose a business type</option>
                  {categories.map((category) => <option key={category}>{category}</option>)}
                </select>
              </label>
              <label className="waybook-login-intake__consent">
                <input name="consent" type="checkbox" required />
                I agree to be contacted about Waybook early access.
              </label>
            </>
          )}
          <input type="text" name="website" autoComplete="off" hidden />
          {state.error ? <p className="waybook-login-error" role="alert">{state.error}</p> : null}
          <button type="submit" disabled={pending}>{pending ? "Submitting…" : staff ? "Send request" : "Join waitlist"}</button>
        </form>
      )}
      <p className="waybook-login-intake__back"><a href={loginPath}>Back to sign in</a></p>
    </>
  );
}
