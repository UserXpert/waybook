import Link from "next/link";
import { randomUUID } from "node:crypto";
import { StripeOnboardingButton } from "@/components/stripe-onboarding-button";
import { tenantDb, type TenantRecord } from "@/lib/waybook/database";
import { stripeLiveConfig, stripeWorkspaceSandboxConfig } from "@/lib/waybook/stripe-connect-api";
import { liveMerchantStatus } from "@/lib/waybook/stripe-live";
import { stripeAppointmentPaymentConfig } from "@/lib/waybook/stripe-payment-mode";
import { sandboxMerchantStatus } from "@/lib/waybook/stripe-sandbox";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { LiveStripePanel } from "./live-stripe-panel";
import { PaymentProviderRow, stripeBrand, type PaymentProviderStatus } from "./payment-provider-row";
import { clearStripePracticeSales, startStripeSandboxOnboarding, startStripeSandboxRehearsal } from "./payment-actions";
import { StripeStatusRefresh } from "./stripe-status-refresh";

const plannedProviders = [
  { id: "quickpay", name: "Quickpay", description: "Cards and MobilePay", logo: "/brand/quickpay-icon.svg" },
  { id: "nets", name: "Nets Easy", description: "Cards and Dankort", logo: "/brand/nets-nexi.svg" },
  { id: "mollie", name: "Mollie", description: "Cards and local methods", logo: "/brand/mollie.png" },
];

const sandboxBadges: Record<Awaited<ReturnType<typeof sandboxMerchantStatus>> | "disabled" | "paused", PaymentProviderStatus> = {
  unconnected: { label: "Not linked" },
  pending: { label: "Setup incomplete", tone: "attention" },
  ready: { label: "Test payments on", tone: "positive" },
  restricted: { label: "Restricted", tone: "attention" },
  disconnected: { label: "Disconnected", tone: "attention" },
  unresolved: { label: "Action needed", tone: "attention" },
  unavailable: { label: "Status unavailable" },
  disabled: { label: "Unavailable" },
  paused: { label: "Paused" },
};

export async function PaymentSettings({ tenant, slug, stripeFeedback, sandboxFeedback }: {
  tenant: TenantRecord;
  slug: string;
  stripeFeedback?: string;
  sandboxFeedback?: string;
}) {
  const liveConfig = stripeLiveConfig(process.env);
  const collection = liveConfig ? stripeAppointmentPaymentConfig(process.env) : null;
  const sandboxConfig = stripeWorkspaceSandboxConfig(process.env);
  const [liveStatus, sandboxStatus, [practiceSales]] = await Promise.all([
    liveConfig ? liveMerchantStatus(tenant.id, liveConfig) : "disabled" as const,
    sandboxConfig ? sandboxMerchantStatus(tenant.id, sandboxConfig) : "disabled" as const,
    sandboxConfig || liveConfig ? tenantDb(tenant)<{ count: number }[]>`
      SELECT count(*)::int AS count FROM commerce_sales WHERE tenant_id=${tenant.id}
        AND is_stripe_practice AND stripe_practice_cleared_at IS NULL
    ` : [],
  ]);
  const practiceCount = practiceSales?.count ?? 0;
  const collectionEnabled = collection?.livemode === true && collection.allowNewPayments;
  const sandboxMode = liveStatus === "ready" && collectionEnabled ? "paused" : sandboxStatus;
  const production = process.env.VERCEL_ENV === "production";
  const feedback = production ? sandboxFeedback : stripeFeedback;

  return <>
    {liveConfig || sandboxConfig ? <StripeStatusRefresh awaitingStripe={
      liveStatus === "pending" || liveStatus === "unavailable" || sandboxMode === "pending" || sandboxMode === "unavailable"
    } /> : null}
    <section className="workspace-settings__panel payment-providers" aria-labelledby="payment-providers-title">
      <h2 id="payment-providers-title">Payment providers</h2>
      <LiveStripePanel status={liveStatus} feedback={stripeFeedback} countries={liveConfig?.allowedCountries ?? []}
        collectionEnabled={collectionEnabled} practiceSalesPending={practiceCount > 0} />
      {plannedProviders.map((provider) => <PaymentProviderRow key={provider.id} {...provider} statuses={[{ label: "Planned" }]}
        actions={<button type="button" className="waybook-action waybook-action--secondary" disabled aria-label={`Connect ${provider.name}`}>Connect</button>} />)}
    </section>
    <section className="workspace-settings__panel payment-providers" aria-labelledby="payment-test-mode-title">
      <h2 id="payment-test-mode-title">Test mode</h2>
      <PaymentProviderRow id="stripe-sandbox" name="Stripe sandbox" description="Test cards only" {...stripeBrand}
        statuses={[sandboxBadges[sandboxMode]]} actions={
          sandboxMode === "unconnected" || sandboxMode === "pending" || sandboxMode === "restricted"
            ? <form action={startStripeSandboxOnboarding}>
              <StripeOnboardingButton label={sandboxMode === "unconnected" ? "Set up Stripe sandbox" : production ? "Continue sandbox setup" : "Continue Stripe setup"} />
            </form>
            : sandboxMode === "ready" ? <form action={startStripeSandboxRehearsal}>
              <input type="hidden" name="nonce" value={randomUUID()} />
              <StripeOnboardingButton label="Start a DKK 10 test payment" />
            </form> : undefined
        }>
        {feedback === "unavailable" ? <p role="alert">Stripe setup could not open. Try again in a moment.</p> : null}
        {feedback === "resume" && sandboxMode === "pending" ? <p role="status">Continue setup to open a fresh Stripe link.</p> : null}
        {sandboxFeedback === "payment-unavailable" ? <p role="alert">Test checkout could not open. Try again in a moment.</p> : null}
      </PaymentProviderRow>
      {sandboxConfig || practiceCount || sandboxFeedback === "cleared" ? <div className="payment-practice-sales">
        <div>
          <h3>Practice sales</h3>
          {sandboxFeedback === "cleared" ? <span role="status">Practice sales cleared.</span> :
            <span>{practiceCount ? `${practiceCount} in Sales` : "No practice sales"}</span>}
        </div>
        {practiceCount ? <div className="payment-provider__actions">
          <Link className="waybook-action waybook-action--secondary" href={tenantPath(slug, "/app/sales/retail")}>View test payments in Sales</Link>
          <form action={clearStripePracticeSales}>
            <button type="submit" name="confirmClear" value="on" className="waybook-action waybook-action--secondary"
              title="Clear only Stripe practice sales. Real sales and receipts stay in place.">
              Clear practice sales ({practiceCount})
            </button>
          </form>
        </div> : null}
      </div> : null}
    </section>
  </>;
}
