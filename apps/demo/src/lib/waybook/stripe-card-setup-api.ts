import { stripeSandboxRequest } from "./stripe-checkout-api";
import type { StripeSandboxConfig } from "./stripe-connect-api";

const sessions = "/v1/checkout/sessions";
const sessionIdPattern = /^cs_test_[A-Za-z0-9]+$/;
const customerIdPattern = /^cus_[A-Za-z0-9]+$/;
const paymentMethodIdPattern = /^pm_[A-Za-z0-9]+$/;

type CardSetup = { id: string; customer: string; expiresAt: number; returnUrl: string };
type SavedCard = { brand: string; last4: string };
type SetupOutcome =
  | { id: string; state: "open"; url: string }
  | { id: string; state: "expired" | "processing" }
  | { id: string; state: "saved"; card: SavedCard; paymentMethodId: string };

type SetupResponse = {
  id?: string;
  object?: string;
  livemode?: boolean;
  mode?: string;
  status?: string;
  customer?: string;
  client_reference_id?: string;
  expires_at?: number;
  payment_intent?: unknown;
  amount_total?: number | null;
  url?: string;
  setup_intent?: {
    id?: string;
    object?: string;
    livemode?: boolean;
    status?: string;
    customer?: string;
    payment_method?: {
      id?: string;
      type?: string;
      customer?: string;
      livemode?: boolean;
      card?: Partial<SavedCard>;
    };
  };
};

function verifySetup(session: SetupResponse | null, setup: CardSetup, expectedId?: string): SetupOutcome {
  if (!session) throw new Error("Stripe did not confirm this client's card setup.");
  const id = session.id;
  if (typeof id !== "string" || !sessionIdPattern.test(id) || (expectedId && id !== expectedId) ||
      session.object !== "checkout.session" || session.livemode !== false || session.mode !== "setup" ||
      session.customer !== setup.customer || session.client_reference_id !== setup.id ||
      session.expires_at !== setup.expiresAt || session.payment_intent != null ||
      (session.amount_total != null && session.amount_total !== 0)) {
    throw new Error("Stripe did not confirm this client's card setup.");
  }
  if (session.status === "expired") return { id, state: "expired" };
  if (session.status === "open" && typeof session.url === "string" && URL.canParse(session.url)) {
    const url = new URL(session.url);
    if (url.origin === "https://checkout.stripe.com" && !url.username && !url.password &&
        url.pathname === `/c/pay/${id}`) return { id, state: "open", url: url.href };
  }
  if (session.status === "complete") {
    const intent = session.setup_intent;
    if (intent?.object !== "setup_intent" || intent.livemode !== false || intent.customer !== setup.customer ||
        !/^seti_[A-Za-z0-9]+$/.test(intent.id ?? "")) throw new Error("Stripe did not confirm this client's setup intent.");
    if (intent.status === "processing") return { id, state: "processing" };
    const method = intent.payment_method;
    const brand = method?.card?.brand;
    const last4 = method?.card?.last4;
    if (intent.status === "succeeded" && method?.type === "card" && method.livemode === false &&
        method.customer === setup.customer && typeof method.id === "string" && paymentMethodIdPattern.test(method.id) &&
        typeof brand === "string" && /^[a-z0-9_]{1,32}$/.test(brand) &&
        typeof last4 === "string" && /^\d{4}$/.test(last4)) {
      return { id, state: "saved", card: { brand, last4 }, paymentMethodId: method.id };
    }
  }
  throw new Error("Stripe returned an unexpected card setup result.");
}

export function stripeCardSetupSandbox(config: StripeSandboxConfig, accountId: string, request: typeof fetch = fetch) {
  const expansion = "expand%5B0%5D=setup_intent.payment_method";

  return {
    async createCustomer(key: string) {
      const response = await stripeSandboxRequest(config, request, accountId, "/v1/customers", "POST", new URLSearchParams(), key);
      const customer = await response.json();
      if (customer?.object !== "customer" || customer.livemode !== false ||
          typeof customer.id !== "string" || !customerIdPattern.test(customer.id)) {
        throw new Error("Stripe did not confirm a sandbox customer.");
      }
      return customer.id as string;
    },
    async create(setup: CardSetup) {
      const success = new URL(setup.returnUrl);
      if (success.origin !== config.origin || success.username || success.password || success.hash ||
          !customerIdPattern.test(setup.customer)) throw new Error("Invalid Stripe card setup context.");
      const cancel = new URL(success);
      cancel.searchParams.delete("cardSetup");
      const response = await stripeSandboxRequest(config, request, accountId, sessions, "POST", new URLSearchParams({
        mode: "setup",
        currency: "dkk",
        customer: setup.customer,
        client_reference_id: setup.id,
        "payment_method_types[0]": "card",
        "expand[0]": "setup_intent.payment_method",
        expires_at: String(setup.expiresAt),
        success_url: success.href,
        cancel_url: cancel.href,
      }), setup.id);
      return verifySetup(await response.json(), setup);
    },
    async allowCardRedisplay(setup: CardSetup, paymentMethodId: string) {
      if (!paymentMethodIdPattern.test(paymentMethodId)) throw new Error("Invalid Stripe card.");
      const response = await stripeSandboxRequest(config, request, accountId, `/v1/payment_methods/${paymentMethodId}`, "POST",
        new URLSearchParams({ allow_redisplay: "always" }), `${setup.id}-redisplay`);
      const method = await response.json();
      if (method?.object !== "payment_method" || method.livemode !== false || method.type !== "card" ||
          method.id !== paymentMethodId || method.customer !== setup.customer || method.allow_redisplay !== "always") {
        throw new Error("Stripe could not confirm this client's saved card for checkout.");
      }
    },
    async retrieve(setup: CardSetup, sessionId: string) {
      if (!sessionIdPattern.test(sessionId)) throw new Error("Invalid Stripe card setup session.");
      const response = await stripeSandboxRequest(config, request, accountId, `${sessions}/${sessionId}?${expansion}`, "GET");
      return verifySetup(await response.json(), setup, sessionId);
    },
  };
}
