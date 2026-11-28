import { StripeOnboardingButton } from "@/components/stripe-onboarding-button";
import type { liveMerchantStatus } from "@/lib/waybook/stripe-live";
import { checkStripeLiveStatus, startStripeLiveOnboarding } from "./payment-actions";

type LiveStripeStatus = Awaited<ReturnType<typeof liveMerchantStatus>>;

const statusDescriptions: Record<LiveStripeStatus, string> = {
  unconnected: "Connect Stripe to set up payments for this workspace.",
  pending: "Your Stripe setup is incomplete or awaiting verification.",
  ready: "Your Stripe account is verified. Waybook card processing is still disabled.",
  restricted: "Stripe has restricted card payments on this account. Review the requirements in Stripe.",
  disconnected: "Stripe could not find this connected account. Review the account in Stripe.",
  unresolved: "An earlier connection attempt needs to be reconciled before setup can continue.",
  unavailable: "Stripe status is temporarily unavailable. Check again in a moment.",
};

const countryNames = new Intl.DisplayNames("en", { type: "region" });

export function LiveStripePanel({ status, feedback, countries, collectionEnabled, practiceSalesPending }: {
  status: LiveStripeStatus;
  feedback?: string;
  countries: readonly string[];
  collectionEnabled: boolean;
  practiceSalesPending: boolean;
}) {
  const canContinue = status === "pending" || status === "restricted";
  const ready = practiceSalesPending ? "Your Stripe account is verified. Clear practice sales before taking live payments." :
    collectionEnabled ? "Stripe has verified your account for appointment payments in Waybook." : statusDescriptions.ready;
  return <section className="workspace-settings__panel" aria-labelledby="stripe-live-title">
    <h2 id="stripe-live-title">Stripe Connect</h2>
    <p>Accept real appointment payments into this clinic’s Stripe account.</p>
    <p role={feedback === "returned" || feedback === "checked" ? "status" : undefined}>
      {status === "ready" ? ready : statusDescriptions[status]}
    </p>
    {feedback === "unavailable" ? <p role="alert">Stripe setup could not open. Try again in a moment.</p> : null}
    {feedback === "country" ? <p role="alert">Select a supported country for your business.</p> : null}
    {feedback === "resume" && canContinue ? <p role="status">Continue setup to open a fresh Stripe link.</p> : null}
    {status === "unconnected" ? <p>Already use Stripe? Sign in to Stripe and choose your existing business if Stripe offers it.</p> : null}
    <div className="workspace-settings__payment-actions">
      {status === "unconnected" || canContinue ? <form action={startStripeLiveOnboarding}>
        {status === "unconnected" ? <label className="workspace-settings__payment-country">
          Business country
          <select name="country" defaultValue="" required>
            <option value="" disabled>Select your business country</option>
            {countries.map((country) => <option key={country} value={country}>{countryNames.of(country)}</option>)}
          </select>
        </label> : null}
        <StripeOnboardingButton label={canContinue ? "Continue Stripe setup" : "Connect Stripe"} />
      </form> : null}
      {status !== "unconnected" ? <form action={checkStripeLiveStatus}>
        <StripeOnboardingButton label="Check Stripe status" checkStatus />
      </form> : null}
    </div>
  </section>;
}
