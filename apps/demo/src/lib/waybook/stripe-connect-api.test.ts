import assert from "node:assert/strict";
import test from "node:test";
import { stripeConnectLive, stripeConnectSandbox, stripeLiveConfig, stripeSandboxConfig } from "./stripe-connect-api";

const config = { secretKey: "sk_test_fixtureKey", origin: "https://waybook.example" };
const accountId = "acct_sandboxFixture";
const account = { id: accountId, object: "v2.core.account", livemode: false, closed: false };

test("Stripe setup rejects live keys and unsafe callback origins", () => {
  assert.equal(stripeSandboxConfig({}), null);
  for (const origin of ["http://waybook.example", "https://waybook.example/path", "https://x@waybook.example", "https://waybook.example/?callback=x"]) {
    assert.equal(stripeSandboxConfig({ WAYBOOK_STRIPE_SANDBOX_SECRET_KEY: config.secretKey, WAYBOOK_STRIPE_SANDBOX_ORIGIN: origin }), null);
  }
  assert.equal(stripeSandboxConfig({ WAYBOOK_STRIPE_SANDBOX_SECRET_KEY: "sk_live_fixtureKey", WAYBOOK_STRIPE_SANDBOX_ORIGIN: config.origin }), null);
  assert.equal(stripeSandboxConfig({ VERCEL_ENV: "production", WAYBOOK_STRIPE_SANDBOX_SECRET_KEY: config.secretKey, WAYBOOK_STRIPE_SANDBOX_ORIGIN: config.origin }), null);
  assert.deepEqual(stripeSandboxConfig({ WAYBOOK_STRIPE_SANDBOX_SECRET_KEY: config.secretKey, WAYBOOK_STRIPE_SANDBOX_ORIGIN: config.origin }), config);
});

const liveConfig = { secretKey: "rk_live_fixtureKey", origin: "https://waybook.example", allowedCountries: ["DK", "SE"] };
const liveAccountId = "acct_liveFixture";
const liveAccount = { ...account, id: liveAccountId, livemode: true };

test("live Stripe requires production, live credentials, a canonical HTTPS origin, and explicit countries", () => {
  const env = {
    VERCEL_ENV: "production",
    WAYBOOK_STRIPE_LIVE_SECRET_KEY: liveConfig.secretKey,
    WAYBOOK_STRIPE_LIVE_ORIGIN: liveConfig.origin,
    WAYBOOK_STRIPE_LIVE_COUNTRIES: "DK, SE,DK",
  };
  assert.deepEqual(stripeLiveConfig(env), liveConfig);
  assert.deepEqual(stripeLiveConfig({ ...env, WAYBOOK_STRIPE_LIVE_ORIGIN: `${liveConfig.origin}/` }), liveConfig);
  for (const vercelEnv of [undefined, "preview", "development"]) {
    assert.equal(stripeLiveConfig({ ...env, VERCEL_ENV: vercelEnv }), null);
  }
  assert.equal(stripeLiveConfig({ ...env, WAYBOOK_STRIPE_LIVE_SECRET_KEY: config.secretKey }), null);
  for (const countries of [undefined, "", "DK,", "DK,SWEDEN", "d1"]) {
    assert.equal(stripeLiveConfig({ ...env, WAYBOOK_STRIPE_LIVE_COUNTRIES: countries }), null);
  }
  for (const origin of ["http://waybook.example", "https://waybook.example/path", "https://x@waybook.example", "https://waybook.example/?callback=x"]) {
    assert.equal(stripeLiveConfig({ ...env, WAYBOOK_STRIPE_LIVE_ORIGIN: origin }), null);
  }
});

test("live merchant creation enforces the country allowlist before calling Stripe", async () => {
  const requests: Request[] = [];
  const stripe = stripeConnectLive(liveConfig, async (input, init) => {
    requests.push(new Request(input, init));
    return Response.json(liveAccount);
  });
  await assert.rejects(() => stripe.createMerchant("live-create", "US"), /country is not enabled/);
  assert.equal(requests.length, 0);
  assert.equal(await stripe.createMerchant("live-create", "SE"), liveAccountId);
  const [request] = requests;
  assert.equal(request.url, "https://api.stripe.com/v2/core/accounts");
  assert.equal(request.headers.get("Authorization"), `Bearer ${liveConfig.secretKey}`);
  assert.equal(request.headers.get("Idempotency-Key"), "live-create");
  assert.deepEqual((await request.json()).identity, { country: "SE" });
  assert.throws(() => stripeConnectLive({ ...liveConfig, secretKey: config.secretKey }), /Invalid live Stripe key/);
});

test("live status and onboarding reject sandbox responses or another merchant's account", async () => {
  const path = "/nordic/app/settings?tab=payments";
  const url = `https://accounts.stripe.com/r/${liveAccountId}#token`;
  for (const payload of [{ ...liveAccount, livemode: false }, { ...liveAccount, id: accountId }]) {
    const stripe = stripeConnectLive(liveConfig, async () => Response.json(payload));
    await assert.rejects(() => stripe.merchantStatus(liveAccountId), /expected live account/);
  }
  const testAccount = stripeConnectLive(liveConfig, async () => Response.json(account));
  await assert.rejects(() => testAccount.createMerchant("live-create", "DK"), /expected live account/);
  const ready = stripeConnectLive(liveConfig, async () => Response.json({
    ...liveAccount, configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
  }));
  assert.equal(await ready.merchantStatus(liveAccountId), "ready");

  const link = { account: liveAccountId, livemode: true, url };
  for (const payload of [{ ...link, livemode: false }, { ...link, account: accountId }]) {
    const stripe = stripeConnectLive(liveConfig, async () => Response.json(payload));
    await assert.rejects(() => stripe.merchantOnboardingLink(liveAccountId, path), /live onboarding link/);
  }
  const stripe = stripeConnectLive(liveConfig, async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://api.stripe.com/v2/core/account_links");
    const body = await request.json();
    assert.equal(body.account, liveAccountId);
    assert.deepEqual(body.use_case.account_onboarding, {
      return_url: `${liveConfig.origin}${path}&stripe=returned`,
      refresh_url: `${liveConfig.origin}${path}&stripe=resume`,
    });
    return Response.json(link);
  });
  assert.equal(await stripe.merchantOnboardingLink(liveAccountId, path), url);
  await assert.rejects(() => stripe.merchantOnboardingLink(liveAccountId, "//other.example/"), /onboarding context/);
  await assert.rejects(() => stripe.merchantOnboardingLink(liveAccountId, "https://user@waybook.example/"), /onboarding context/);
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
  const url = `https://connect.stripe.com/setup/e/${accountId}/token`;
  const stripe = stripeConnectSandbox(config, async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://api.stripe.com/v2/core/account_links");
    assert.deepEqual(await request.json(), {
      account: accountId,
      use_case: { type: "account_onboarding", account_onboarding: {
        return_url: config.origin + settings + "&stripe=returned",
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
