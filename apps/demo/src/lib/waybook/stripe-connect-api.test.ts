import assert from "node:assert/strict";
import test from "node:test";
import { stripeConnectSandbox, stripeSandboxConfig } from "./stripe-connect-api";

const config = { secretKey: "sk_test_fixtureKey", origin: "https://waybook.example" };
const accountId = "acct_sandboxFixture";
const account = { id: accountId, object: "v2.core.account", livemode: false, closed: false };

test("Stripe setup rejects live keys and unsafe callback origins", () => {
  assert.equal(stripeSandboxConfig({}), null);
  for (const origin of ["http://waybook.example", "https://waybook.example/path", "https://x@waybook.example", "https://waybook.example/?callback=x"]) {
    assert.equal(stripeSandboxConfig({ WAYBOOK_STRIPE_SANDBOX_SECRET_KEY: config.secretKey, WAYBOOK_STRIPE_SANDBOX_ORIGIN: origin }), null);
  }
  assert.equal(stripeSandboxConfig({ WAYBOOK_STRIPE_SANDBOX_SECRET_KEY: "sk_live_fixtureKey", WAYBOOK_STRIPE_SANDBOX_ORIGIN: config.origin }), null);
  assert.deepEqual(stripeSandboxConfig({ WAYBOOK_STRIPE_SANDBOX_SECRET_KEY: config.secretKey, WAYBOOK_STRIPE_SANDBOX_ORIGIN: config.origin }), config);
});

test("merchant creation uses Stripe's sandbox request and stable idempotency", async () => {
  const requests: Request[] = [];
  const stripe = stripeConnectSandbox(config, async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(account);
  });
  for (let attempt = 0; attempt < 2; attempt++) assert.equal(await stripe.createMerchant("one-creation"), accountId);
  for (const request of requests) {
    assert.equal(request.url, "https://api.stripe.com/v2/core/accounts");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("Idempotency-Key"), "one-creation");
    assert.equal(request.redirect, "error");
    assert.deepEqual(await request.json(), {
      dashboard: "full",
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      identity: { country: "DK" },
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
    });
  }
});

test("account status requires the expected Stripe account and mode", async () => {
  const merchant = (status: string, status_details?: { code: string }[]) => ({
    ...account, configuration: { merchant: { capabilities: { card_payments: { status, status_details } } } },
  });
  for (const [payload, status] of [
    [merchant("active"), "ready"],
    [merchant("restricted", [{ code: "requirements_past_due" }]), "pending"],
    [merchant("restricted", [{ code: "restricted_other" }]), "restricted"],
    [{ ...merchant("active"), closed: true }, "disconnected"],
  ] as const) {
    const stripe = stripeConnectSandbox(config, async () => Response.json(payload));
    assert.equal(await stripe.merchantStatus(accountId), status);
  }
  for (const bad of [{ ...account, id: "acct_other" }, { ...account, livemode: true }]) {
    const stripe = stripeConnectSandbox(config, async () => Response.json(bad));
    await assert.rejects(() => stripe.merchantStatus(accountId), /expected sandbox account/);
  }
});

test("onboarding links stay scoped to the selected account and Stripe's origin", async () => {
  const settings = "/nordic/app/settings?tab=payments";
  const url = `https://accounts.stripe.com/r/${accountId}#link`;
  const stripe = stripeConnectSandbox(config, async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://api.stripe.com/v2/core/account_links");
    assert.deepEqual(await request.json(), {
      account: accountId,
      use_case: { type: "account_onboarding", account_onboarding: {
        configurations: ["merchant"],
        return_url: config.origin + settings,
        refresh_url: config.origin + settings + "&stripe=resume",
      } },
    });
    return Response.json({ account: accountId, livemode: false, url });
  });
  assert.equal(await stripe.merchantOnboardingLink(accountId, settings), url);
  await assert.rejects(() => stripe.merchantOnboardingLink(accountId, "//other.example/"), /onboarding context/);
  for (const payload of [
    { account: "acct_other", livemode: false, url },
    { account: accountId, livemode: true, url },
    { account: accountId, livemode: false, url: "https://accounts.stripe.com.other.example/" },
  ]) {
    const invalid = stripeConnectSandbox(config, async () => Response.json(payload));
    await assert.rejects(() => invalid.merchantOnboardingLink(accountId, settings), /Stripe/);
  }
});
