import { StripeOnboardingButton } from "@/components/stripe-onboarding-button";
import type { liveMerchantStatus } from "@/lib/waybook/stripe-live";
import { startStripeLiveOnboarding } from "./payment-actions";
import { StripeSettingsCard } from "./stripe-settings-card";

type LiveStripeStatus = Awaited<ReturnType<typeof liveMerchantStatus>>;

const statusDescriptions: Record<LiveStripeStatus, string> = {
  unconnected: "Connect Stripe to set up payments for this workspace.",
  pending: "Your Stripe setup is incomplete or awaiting verification.",
  ready: "Your Stripe account is verified. Live payments are off in Waybook.",
  restricted: "Stripe has restricted card payments on this account. Review the requirements in Stripe.",
  disconnected: "Stripe could not find this connected account. Review the account in Stripe.",
  unresolved: "An earlier connection attempt needs to be reconciled before setup can continue.",
  unavailable: "Waybook is waiting for Stripe to confirm your account status.",
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
  const ready = !collectionEnabled ? statusDescriptions.ready : practiceSalesPending
    ? "Clear practice sales to start accepting live appointment payments."
    : "Live appointment payments are enabled and go to this clinic’s Stripe account.";
  return <StripeSettingsCard mode="live" status={status}>
    <p>{status === "ready" ? ready : statusDescriptions[status]}</p>
    {feedback === "unavailable" ? <p role="alert">Stripe setup could not open. Try again in a moment.</p> : null}
    {feedback === "country" ? <p role="alert">Select a supported country for your business.</p> : null}
    {feedback === "resume" && canContinue ? <p role="status">Continue setup to open a fresh Stripe link.</p> : null}
    {status === "unconnected" ? <p>Already use Stripe? Sign in to Stripe and choose your existing business if Stripe offers it.</p> : null}
    {status === "unconnected" || canContinue ? <div className="workspace-settings__payment-actions">
      <form action={startStripeLiveOnboarding}>
        {status === "unconnected" ? <label className="workspace-settings__payment-country">
          Business country
          <select name="country" defaultValue="" required>
            <option value="" disabled>Select your business country</option>
            {countries.map((country) => <option key={country} value={country}>{countryNames.of(country)}</option>)}
          </select>
        </label> : null}
        <StripeOnboardingButton label={canContinue ? "Continue Stripe setup" : "Connect Stripe"} />
      </form>
    </div> : null}
  </StripeSettingsCard>;
}
