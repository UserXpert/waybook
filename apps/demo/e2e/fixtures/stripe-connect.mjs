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
const error = (status) => Response.json({ error: "stripe fixture error" }, { status });

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin !== "https://api.stripe.com") return originalFetch(input, init);
  const request = new Request(input, init);
  if (request.headers.get("Authorization") !== `Bearer ${secret}`) return error(401);
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
