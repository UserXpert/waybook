import { StripeOnboardingButton } from "@/components/stripe-onboarding-button";
import type { liveMerchantStatus } from "@/lib/waybook/stripe-live";
import { startStripeLiveOnboarding } from "./payment-actions";
import { PaymentProviderRow, stripeBrand, type PaymentProviderStatus } from "./payment-provider-row";

type LiveStripeStatus = Awaited<ReturnType<typeof liveMerchantStatus>> | "disabled";

const connectionStatus: Record<LiveStripeStatus, PaymentProviderStatus> = {
  unconnected: { label: "Not linked" },
  pending: { label: "Setup incomplete", tone: "attention" },
  ready: { label: "Linked", tone: "positive" },
  restricted: { label: "Restricted", tone: "attention" },
  disconnected: { label: "Disconnected", tone: "attention" },
  unresolved: { label: "Action needed", tone: "attention" },
  unavailable: { label: "Status unavailable" },
  disabled: { label: "Unavailable" },
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
  const statuses = [connectionStatus[status]];
  if (status === "ready") {
    statuses.push(!collectionEnabled ? { label: "Live collection off" } : practiceSalesPending
      ? { label: "Clear practice sales", tone: "attention" } : { label: "Live payments on", tone: "positive" });
  }
  const actions = status === "unconnected" || canContinue ? <form action={startStripeLiveOnboarding}>
    {status === "unconnected" ? <select name="country" aria-label="Business country"
      defaultValue={countries.length === 1 ? countries[0] : ""} required>
      <option value="" disabled>Business country</option>
      {countries.map((country) => <option key={country} value={country}>{countryNames.of(country)}</option>)}
    </select> : null}
    <StripeOnboardingButton label={canContinue ? "Continue Stripe setup" : "Connect Stripe"} />
  </form> : null;
  return <PaymentProviderRow id="stripe-live" name="Stripe Connect" description="Online cards and MobilePay"
    {...stripeBrand} statuses={statuses} actions={actions}>
    {feedback === "unavailable" ? <p role="alert">Stripe setup could not open. Try again in a moment.</p> : null}
    {feedback === "country" ? <p role="alert">Select a supported country for your business.</p> : null}
    {feedback === "resume" && canContinue ? <p role="status">Continue setup to open a fresh Stripe link.</p> : null}
  </PaymentProviderRow>;
}
