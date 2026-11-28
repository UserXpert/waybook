import assert from "node:assert/strict";
import test from "node:test";
import { stripeSandboxConfig, stripeWorkspaceSandboxConfig } from "./stripe-connect-api";
import { listSandboxRehearsals, openSandboxRehearsal } from "./stripe-sandbox-rehearsal";

const origin = "https://waybook.example";
const account = "acct_nordicSandbox";
const nonce = "6f47d356-3183-41c6-9ce3-61d4decccd48";
const reference = `waybook-rehearsal-${nonce}`;
const settings = "/nordic/app/settings?tab=payments";
const config = { origin, secretKey: "rk_test_rehearsalFixture" };
const session = {
  id: "cs_test_rehearsal", object: "checkout.session", livemode: false, mode: "payment",
  amount_total: 1000, currency: "dkk", client_reference_id: reference, status: "open",
  payment_status: "unpaid", created: 1795850000, url: "https://checkout.stripe.com/c/pay/cs_test_rehearsal",
};

test("workspace sandbox config never enables sandbox appointments in production", () => {
  const env = {
    NODE_ENV: "production", VERCEL_ENV: "production",
    WAYBOOK_STRIPE_WORKSPACE_SANDBOX_SECRET_KEY: config.secretKey,
    WAYBOOK_STRIPE_WORKSPACE_SANDBOX_ORIGIN: origin,
  } as const;
  assert.deepEqual(stripeWorkspaceSandboxConfig(env), config);
  assert.equal(stripeSandboxConfig(env), null);
  assert.equal(stripeWorkspaceSandboxConfig({ ...env, WAYBOOK_STRIPE_WORKSPACE_SANDBOX_SECRET_KEY: "rk_live_fixture" }), null);
});

test("rehearsal creates a tenant-scoped sandbox checkout and rejects forged live responses", async () => {
  const request: typeof fetch = async (input, init) => {
    assert.equal(input, "https://api.stripe.com/v1/checkout/sessions");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Stripe-Account"), account);
    assert.equal(headers.get("Idempotency-Key"), reference);
    const body = init?.body as URLSearchParams;
    assert.equal(body.get("client_reference_id"), reference);
    assert.equal(body.get("success_url"), origin + settings + "&sandbox=payment-returned");
    assert.equal(body.get("cancel_url"), origin + settings + "&sandbox=payment-cancelled");
    assert.equal(body.get("line_items[0][price_data][unit_amount]"), "1000");
    return Response.json(session);
  };
  assert.equal(await openSandboxRehearsal(config, account, settings, nonce, request), session.url);
  await assert.rejects(() => openSandboxRehearsal(config, account, settings, nonce, async () =>
    Response.json({ ...session, livemode: true })));
});

test("practice history reads only tagged test payments from the workspace sandbox", async () => {
  const items = await listSandboxRehearsals(config, account, async (input, init) => {
    assert.equal(input, "https://api.stripe.com/v1/checkout/sessions?limit=30");
    assert.equal(new Headers(init?.headers).get("Stripe-Account"), account);
    return Response.json({ data: [
      { ...session, status: "complete", payment_status: "paid" },
      { ...session, id: "cs_test_pending", status: "open" },
      { ...session, id: "cs_test_actualAppointment", client_reference_id: nonce },
      { ...session, id: "cs_live_foreign", livemode: true },
    ] });
  });
  assert.deepEqual(items.map(({ id, state }) => [id, state]), [["cs_test_rehearsal", "Paid"], ["cs_test_pending", "Awaiting payment"]]);
});
