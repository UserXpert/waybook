import assert from "node:assert/strict";
import test from "node:test";
import { stripeCardSetupSandbox } from "./stripe-card-setup-api";

const config = { secretKey: "sk_test_fixture", origin: "https://preview.example.test" };
const setup = {
  id: "a381593d-9f1d-4912-8d1b-97c55866caa9",
  customer: "cus_expected",
  expiresAt: 1_800_007_200,
  returnUrl: `${config.origin}/nordic/app/calendars?booking=example&cardSetup=return`,
};
const session = {
  id: "cs_test_expected", object: "checkout.session", mode: "setup", status: "complete",
  livemode: false, customer: setup.customer, client_reference_id: setup.id, expires_at: setup.expiresAt,
  payment_intent: null, amount_total: null,
  setup_intent: {
    id: "seti_expected", object: "setup_intent", status: "succeeded", customer: setup.customer, livemode: false,
    payment_method: { id: "pm_expected", type: "card", customer: setup.customer, livemode: false,
      card: { brand: "visa", last4: "4242" } },
  },
};

test("creates a setup-only session with an existing connected-account customer", async () => {
  const api = stripeCardSetupSandbox(config, "acct_expected", async (url, init) => {
    assert.equal(url, "https://api.stripe.com/v1/checkout/sessions");
    const request = new Request(url, init);
    assert.equal(request.headers.get("Stripe-Account"), "acct_expected");
    assert.equal(request.headers.get("Idempotency-Key"), setup.id);
    const body = new URLSearchParams(await request.text());
    assert.equal(body.get("mode"), "setup");
    assert.equal(body.get("customer"), setup.customer);
    assert.equal(body.get("cancel_url"), `${config.origin}/nordic/app/calendars?booking=example`);
    assert.equal([...body.keys()].some((key) => key.startsWith("line_items") || key.startsWith("payment_intent_data")), false);
    return Response.json({ ...session, status: "open", setup_intent: null, url: "https://checkout.stripe.com/c/pay/cs_test_expected" });
  });
  assert.deepEqual(await api.create(setup), {
    id: session.id, state: "open", url: "https://checkout.stripe.com/c/pay/cs_test_expected",
  });
  await assert.rejects(api.create({ ...setup, returnUrl: "https://other.example.test" }), /Invalid Stripe card setup context/);
});

test("exposes only the card mask and rejects cross-client, live, and payment sessions", async () => {
  const apiFor = (body: object) => stripeCardSetupSandbox(config, "acct_expected", async (url, init) => {
    const request = new Request(url, init);
    assert.equal(request.headers.get("Stripe-Account"), "acct_expected");
    assert.equal(new URL(request.url).searchParams.get("expand[0]"), "setup_intent.payment_method");
    return Response.json(body);
  });
  assert.deepEqual(await apiFor(session).retrieve(setup, session.id), {
    id: session.id, state: "saved", card: { brand: "visa", last4: "4242" },
  });
  const invalid = [
    { ...session, customer: "cus_unrelated" },
    { ...session, id: "cs_test_unrelated" },
    { ...session, client_reference_id: "unrelated" },
    { ...session, livemode: true },
    { ...session, mode: "payment", payment_intent: "pi_present" },
    { ...session, setup_intent: { ...session.setup_intent, payment_method: { ...session.setup_intent.payment_method, customer: "cus_unrelated" } } },
  ];
  for (const result of invalid) {
    await assert.rejects(apiFor(result).retrieve(setup, session.id), /Stripe/);
  }
});
