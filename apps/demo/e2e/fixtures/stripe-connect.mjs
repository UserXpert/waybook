// Preloaded only on the Playwright server. No request reaches Stripe.
const origin = "http://localhost:3336";
const secret = "sk_test_waybookE2EFixture";
if (process.env.WAYBOOK_STRIPE_SANDBOX_ORIGIN !== origin ||
    process.env.WAYBOOK_STRIPE_SANDBOX_SECRET_KEY !== secret) {
  throw new Error("Stripe fixture requires the disposable Waybook E2E server.");
}
for (const name of ["CONTROL", "NORDIC_STUDIO", "COPENHAGEN_PHYSIO"]) {
  const url = new URL(process.env[`WAYBOOK_${name}_DATABASE_URL`]);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.pathname.startsWith("/waybook_e2e_")) {
    throw new Error("Stripe fixture requires disposable loopback databases.");
  }
}

const originalFetch = globalThis.fetch;
const accounts = new Map();
const sessions = new Map();
const cardCustomers = new Set();
const cardSetups = new Map();
const redisplayCustomers = new Set();
const refunds = new Map();
const refundReads = new Map();
const error = (status) => Response.json({ error: "stripe fixture error" }, { status });

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== "https://api.stripe.com") return originalFetch(input, init);
  const request = new Request(input, init);
  if (request.headers.get("Authorization") !== `Bearer ${secret}`) return error(401);
  if (url.pathname === "/v1/payment_method_configurations" && request.method === "GET") {
    if (request.headers.get("Stripe-Account") !== "acct_checkoutFixture") return error(403);
    return Response.json({ object: "list", has_more: false, data: [{
      id: "pmc_fixturemobilepay", object: "payment_method_configuration", parent: "pmc_fixtureparent",
      active: true, is_default: true, livemode: false,
      mobilepay: { available: true, display_preference: { value: "on" } },
    }] });
  }
  if (url.pathname.startsWith("/v1/refunds")) {
    if (request.headers.get("Stripe-Account") !== "acct_checkoutFixture") return error(403);
    if (request.method === "POST" && url.pathname === "/v1/refunds") {
      const body = new URLSearchParams(await request.text());
      const key = request.headers.get("Idempotency-Key");
      const intent = body.get("payment_intent");
      const amount = Number(body.get("amount"));
      if (!key || body.get("metadata[waybook_refund_attempt]") !== key || !intent ||
          ![...sessions.values()].some(({ checkout }) => checkout.payment_intent === intent) || amount <= 0) return error(400);
      const id = `re_${key.replaceAll("-", "")}`;
      if (refunds.has(id)) return Response.json(refunds.get(id));
      const pending = [1101, 1202, 1303].includes(amount);
      const refund = {
        id, object: "refund", payment_intent: intent, amount, currency: "dkk",
        metadata: { waybook_refund_attempt: key }, status: pending ? "pending" : "succeeded",
      };
      refunds.set(id, refund);
      if (pending && amount !== 1202) return error(503);
      return Response.json(refund);
    }
    const refundId = url.pathname.split("/").at(-1);
    if (request.method === "GET" && /^re_dashboard[A-Za-z0-9]+$/.test(refundId)) {
      const suffix = refundId.slice("re_dashboard".length);
      const intent = `pi_${suffix}`;
      const session = sessions.get(`cs_test_${suffix}`);
      if (session?.checkout.amount_total !== 6503 || session.checkout.status === "expired") return error(404);
      // The Dashboard refund exists after the card paid on Stripe, before Waybook received the success event.
      Object.assign(session.checkout, { status: "complete", payment_status: "paid", payment_intent: intent, url: null });
      return Response.json({ id: refundId, object: "refund", payment_intent: intent, amount: 503, currency: "dkk",
        metadata: {}, status: "succeeded" });
    }
    const refund = refunds.get(refundId);
    if (!refund || request.method !== "GET") return error(404);
    const reads = (refundReads.get(refundId) ?? 0) + 1;
    refundReads.set(refundId, reads);
    refund.status = refund.amount === 1202 || (refund.amount === 1303 && reads >= 3) ? "failed" : "succeeded";
    if (refund.amount === 1303 && reads >= 4) refund.failure_balance_transaction = `txn_${refundId.slice(3)}`;
    return Response.json(refund);
  }
  if (url.pathname === "/v1/customers" && request.method === "POST") {
    const key = request.headers.get("Idempotency-Key");
    if (request.headers.get("Stripe-Account") !== "acct_checkoutFixture" || !key) return error(400);
    const id = `cus_${key.replaceAll("-", "")}`;
    cardCustomers.add(id);
    return Response.json({ id, object: "customer", livemode: false });
  }
  if (url.pathname.startsWith("/v1/payment_methods/") && request.method === "POST") {
    const methodId = url.pathname.split("/").at(-1);
    const setup = [...cardSetups.values()].find(({ session }) => session.setup_intent?.payment_method?.id === methodId);
    const body = new URLSearchParams(await request.text());
    if (!setup || request.headers.get("Stripe-Account") !== "acct_checkoutFixture" ||
        request.headers.get("Idempotency-Key") !== `${setup.session.client_reference_id}-redisplay` ||
        body.get("allow_redisplay") !== "always") return error(400);
    redisplayCustomers.add(setup.session.customer);
    return Response.json({ ...setup.session.setup_intent.payment_method, object: "payment_method", allow_redisplay: "always" });
  }
  if (url.pathname.startsWith("/v1/checkout/sessions")) {
    const account = request.headers.get("Stripe-Account");
    if (account !== "acct_checkoutFixture") return error(403);
    if (request.method === "GET" && url.pathname === "/v1/checkout/sessions") {
      const intent = url.searchParams.get("payment_intent");
      if (!intent?.startsWith("pi_") || url.searchParams.get("limit") !== "2") return error(400);
      return Response.json({ object: "list", has_more: false,
        data: [...sessions.values()].map(({ checkout }) => checkout).filter((checkout) => checkout.payment_intent === intent) });
    }
    if (url.pathname === "/v1/checkout/sessions" && request.method === "POST") {
      const body = new URLSearchParams(await request.text());
      const key = request.headers.get("Idempotency-Key");
      if (body.get("mode") === "setup") {
        const customer = body.get("customer");
        if (!key || body.get("client_reference_id") !== key || !cardCustomers.has(customer) || body.get("currency") !== "dkk" ||
            body.get("allowed_payment_method_types[0]") !== "card" || body.has("payment_method_types[0]") ||
            [...body.keys()].some((field) => field.startsWith("line_items")) ||
            !body.get("success_url")?.startsWith(origin + "/nordic/app/calendars?booking=") ||
            !body.get("success_url")?.endsWith("&cardSetup=return") ||
            body.get("cancel_url") !== body.get("success_url").replace("&cardSetup=return", "")) return error(400);
        const id = `cs_test_card${key.replaceAll("-", "")}`;
        const existing = cardSetups.get(id);
        if (existing) return existing.request === body.toString() ? Response.json(existing.session) : error(409);
        const session = { id, object: "checkout.session", livemode: false, mode: "setup", status: "open", customer,
          client_reference_id: key, expires_at: Number(body.get("expires_at")), url: `https://checkout.stripe.com/c/pay/${id}`,
          payment_intent: null, amount_total: null };
        cardSetups.set(id, { request: body.toString(), reads: 0, session });
        return Response.json(session);
      }
      const amount = Number(body.get("line_items[0][price_data][unit_amount]"));
      const customer = body.get("customer");
      const method = body.get("allowed_payment_method_types[0]");
      if (customer && !redisplayCustomers.has(customer)) return error(400);
      if (!key || body.get("client_reference_id") !== key || body.get("mode") !== "payment" ||
          body.get("line_items[0][price_data][currency]") !== "dkk" ||
          !["card", "mobilepay"].includes(method) || body.get("adaptive_pricing[enabled]") !== "false" ||
          !body.get("success_url")?.startsWith(origin + "/nordic/app/sales?booking=")) return error(400);
      if (method === "mobilepay" && (amount !== 6505 || customer || body.has("payment_method_types[0]") ||
          [...body.keys()].filter((field) => field.startsWith("allowed_payment_method_types[")).length !== 1)) return error(400);
      const id = `cs_test_${key.replaceAll("-", "")}`;
      const existing = sessions.get(id);
      if (existing) return existing.request === body.toString() ? Response.json(existing.checkout) : error(409);
      const checkout = {
        id, object: "checkout.session", livemode: false, mode: "payment",
        client_reference_id: key, amount_total: amount, currency: "dkk", customer,
        expires_at: Number(body.get("expires_at")), payment_method_types: [method],
        status: "open", payment_status: "unpaid", url: `https://checkout.stripe.com/c/pay/${id}`,
      };
      sessions.set(id, { request: body.toString(), reads: 0, checkout });
      return method === "mobilepay" ? Response.json(checkout) : error(503);
    }
    const [, id, expiration] = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_test_[A-Za-z0-9]+)(\/expire)?$/) ?? [];
    const setup = cardSetups.get(id);
    if (setup && request.method === "GET" && !expiration) {
      if (url.searchParams.get("expand[0]") !== "setup_intent.payment_method") return error(400);
      if (++setup.reads >= 2) Object.assign(setup.session, { status: "complete", url: null, setup_intent: {
        id: `seti_${id.slice(8)}`, object: "setup_intent", livemode: false, status: "succeeded", customer: setup.session.customer,
        payment_method: { id: `pm_${id.slice(8)}`, type: "card", customer: setup.session.customer, livemode: false,
          card: { brand: "visa", last4: "4242" } },
      } });
      return Response.json(setup.session);
    }
    const session = sessions.get(id);
    if (!session) return error(404);
    if (request.method === "POST" && expiration && session.checkout.status === "open") {
      Object.assign(session.checkout, { status: "expired", url: null });
    } else if (request.method === "GET" && !expiration) {
      session.reads++;
      const mobilePay = session.checkout.payment_method_types[0] === "mobilepay";
      const completesPayment = mobilePay || [6501, 6503].includes(session.checkout.amount_total) ||
        redisplayCustomers.has(session.checkout.customer);
      if (completesPayment && session.reads >= 2 && session.checkout.status === "open") {
        Object.assign(session.checkout, { status: "complete", payment_status: "paid", payment_intent: `pi_${id.slice(8)}`, url: null });
      }
      if (session.checkout.amount_total === 6504) Object.assign(session.checkout, { status: "expired", url: null });
    } else return error(400);
    return Response.json(session.checkout);
  }
  const accountData = (id, active) => ({
    id, object: "v2.core.account", livemode: false, closed: false,
    configuration: { merchant: { capabilities: { card_payments: { status: active ? "active" : "pending" } } } },
  });

  if (request.method === "POST" && url.pathname === "/v2/core/accounts") {
    const body = await request.json();
    const key = request.headers.get("Idempotency-Key");
    if (!key || body.identity?.country !== "DK" || body.dashboard !== "full" ||
        body.defaults?.responsibilities?.losses_collector !== "stripe" ||
        body.configuration?.merchant?.capabilities?.card_payments?.requested !== true) return error(400);
    const id = `acct_${key.replaceAll("-", "")}`;
    if (!accounts.has(id)) {
      accounts.set(id, { links: 0 });
      // The account exists even though the first response could not be delivered.
      return error(503);
    }
    return Response.json(accountData(id, false));
  }

  if (request.method === "GET" && url.pathname.startsWith("/v2/core/accounts/")) {
    const id = url.pathname.split("/").at(-1);
    if (id === "acct_checkoutFixture") return Response.json(accountData(id, true));
    const account = accounts.get(id);
    return account ? Response.json(accountData(id, account.links >= 2)) : error(404);
  }

  if (request.method === "POST" && url.pathname === "/v2/core/account_links") {
    const body = await request.json();
    const account = accounts.get(body.account);
    const onboarding = body.use_case?.account_onboarding;
    const returnUrl = onboarding?.return_url;
    if (!account || body.use_case?.type !== "account_onboarding" ||
        typeof returnUrl !== "string" || !returnUrl.startsWith(origin + "/") || !returnUrl.endsWith("&stripe=returned") ||
        onboarding?.refresh_url !== returnUrl.replace("&stripe=returned", "&stripe=resume")) {
      return error(400);
    }
    account.links += 1;
    return Response.json({ account: body.account, livemode: false,
      url: `https://accounts.stripe.com/r/${body.account}` });
  }
  return error(404);
};
