import Image from "next/image";
import type { StripeMerchantStatus } from "@/lib/waybook/stripe-connect-api";

type StripeSettingsStatus = StripeMerchantStatus | "unconnected" | "unresolved" | "unavailable" | "disabled";

const labels: Record<StripeSettingsStatus, string> = {
  unconnected: "Not linked",
  pending: "Setup in progress",
  ready: "Linked",
  restricted: "Action needed",
  disconnected: "Disconnected",
  unresolved: "Action needed",
  unavailable: "Status unavailable",
  disabled: "Unavailable",
};

export function StripeSettingsCard({ mode, status, children }: {
  mode: "live" | "sandbox";
  status: StripeSettingsStatus;
  children: React.ReactNode;
}) {
  const titleId = `stripe-${mode}-title`;
  return <section className="workspace-settings__panel stripe-settings-card" aria-labelledby={titleId}>
    <header className="stripe-settings-card__header">
      <Image className="stripe-wordmark stripe-wordmark--light" src="/brand/stripe-blurple.svg" width={54} height={26} alt="" />
      <Image className="stripe-wordmark stripe-wordmark--dark" src="/brand/stripe-white.svg" width={54} height={26} alt="" />
      <span className="stripe-settings-card__status" data-status={status} role="status">{labels[status]}</span>
    </header>
    <h2 id={titleId}>{mode === "live" ? "Stripe Connect" : "Stripe sandbox"}</h2>
    {children}
  </section>;
}
