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
const error = (status) => Response.json({ error: "stripe fixture error" }, { status });

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== "https://api.stripe.com") return originalFetch(input, init);
  const request = new Request(input, init);
  if (request.headers.get("Authorization") !== `Bearer ${secret}`) return error(401);
  if (url.pathname.startsWith("/v1/checkout/sessions")) {
    const account = request.headers.get("Stripe-Account");
    if (account !== "acct_checkoutFixture") return error(403);
    if (url.pathname === "/v1/checkout/sessions" && request.method === "POST") {
      const body = new URLSearchParams(await request.text());
      const key = request.headers.get("Idempotency-Key");
      const amount = Number(body.get("line_items[0][price_data][unit_amount]"));
      if (!key || body.get("client_reference_id") !== key || body.get("mode") !== "payment" ||
          body.get("line_items[0][price_data][currency]") !== "dkk" ||
          body.get("payment_method_types[0]") !== "card" || body.get("adaptive_pricing[enabled]") !== "false" ||
          !body.get("success_url")?.startsWith(origin + "/nordic/app/sales?booking=")) return error(400);
      const id = `cs_test_${key.replaceAll("-", "")}`;
      const existing = sessions.get(id);
      if (existing) return existing.request === body.toString() ? Response.json(existing.checkout) : error(409);
      sessions.set(id, {
        request: body.toString(), reads: 0, checkout: {
          id, object: "checkout.session", livemode: false, mode: "payment",
          client_reference_id: key, amount_total: amount, currency: "dkk",
          expires_at: Number(body.get("expires_at")), payment_method_types: ["card"],
          status: "open", payment_status: "unpaid", url: `https://checkout.stripe.com/c/pay/${id}`,
        },
      });
      return error(503);
    }
    const [, id, expiration] = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_test_[A-Za-z0-9]+)(\/expire)?$/) ?? [];
    const session = sessions.get(id);
    if (!session) return error(404);
    if (request.method === "POST" && expiration && session.checkout.status === "open") {
      Object.assign(session.checkout, { status: "expired", url: null });
    } else if (request.method === "GET" && !expiration) {
      session.reads++;
      if (session.checkout.amount_total === 6501 && session.reads >= 2 && session.checkout.status === "open") {
        Object.assign(session.checkout, { status: "complete", payment_status: "paid", payment_intent: `pi_${id.slice(8)}`, url: null });
      }
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
    if (!account || body.use_case?.type !== "account_onboarding" || onboarding.configurations.join() !== "merchant" ||
        !onboarding.return_url.startsWith(origin + "/") || onboarding.refresh_url !== onboarding.return_url + "&stripe=resume") {
      return error(400);
    }
    account.links += 1;
    return Response.json({ account: body.account, livemode: false,
      url: `https://accounts.stripe.com/r/${body.account}` });
  }
  return error(404);
};
