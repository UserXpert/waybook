import assert from "node:assert/strict";
import test from "node:test";
import { stripeRefundSandbox } from "./stripe-refund-api";

const config = { secretKey: "sk_test_fixture", origin: "https://waybook.example" };
const attempt = { id: "ab60260a-14a7-4c38-8d29-d78804a53616", accountId: "acct_fixture", paymentIntentId: "pi_fixture", amountCents: 1101 };
const payload = {
  id: "re_fixture", object: "refund", payment_intent: attempt.paymentIntentId,
  amount: attempt.amountCents, currency: "dkk", status: "succeeded",
  metadata: { waybook_refund_attempt: attempt.id },
};

test("Stripe refund retries retain the original account, amount and request identifier", async () => {
  const requests: Request[] = [];
  const stripe = stripeRefundSandbox(config, async (input, init) => {
    requests.push(new Request(input, init));
    return requests.length === 1 ? new Response(null, { status: 503 }) : Response.json(payload);
  });
  await assert.rejects(() => stripe.create(attempt), /could not be confirmed/);
  assert.deepEqual(await stripe.create(attempt), { id: payload.id, state: "succeeded" });
  for (const request of requests) {
    assert.equal(request.url, "https://api.stripe.com/v1/refunds");
    assert.equal(request.headers.get("Stripe-Account"), attempt.accountId);
    assert.equal(request.headers.get("Idempotency-Key"), attempt.id);
    assert.deepEqual(Object.fromEntries(new URLSearchParams(await request.text())), {
      payment_intent: attempt.paymentIntentId, amount: "1101", "metadata[waybook_refund_attempt]": attempt.id,
    });
  }
});

test("Stripe refund retrieval preserves failure and pending without treating them as credit", async () => {
  for (const [status, state] of [["requires_action", "pending"], ["pending", "pending"], ["failed", "failed"], ["canceled", "canceled"]]) {
    const stripe = stripeRefundSandbox(config, async (input, init) => {
      const request = new Request(input, init);
      assert.equal(request.url, `https://api.stripe.com/v1/refunds/${payload.id}`);
      assert.equal(request.method, "GET");
      return Response.json({ ...payload, status });
    });
    assert.deepEqual(await stripe.retrieve(attempt, payload.id), { id: payload.id, state });
  }
});

test("Stripe refund rejects a mismatched payment, amount, identifier, currency or reference", async () => {
  for (const wrong of [
    { id: "re_elsewhere" }, { payment_intent: "pi_elsewhere" }, { amount: 1 }, { currency: "usd" },
    { metadata: {} }, { livemode: true }, { status: "unknown" },
  ]) {
    const stripe = stripeRefundSandbox(config, async () => Response.json({ ...payload, ...wrong }));
    await assert.rejects(() => stripe.retrieve(attempt, payload.id), /Stripe/);
  }
  const live = stripeRefundSandbox({ ...config, secretKey: "sk_live_fixture" }, async () => assert.fail("Live request sent"));
  await assert.rejects(() => live.create(attempt), /Invalid Stripe sandbox refund/);
});
