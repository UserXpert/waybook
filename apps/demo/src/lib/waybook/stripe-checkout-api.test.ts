import assert from "node:assert/strict";
import test from "node:test";
import { stripeCheckoutSandbox } from "./stripe-checkout-api";

const config = { secretKey: "sk_test_fixture", origin: "https://waybook.example" };
const attempt = {
  id: "ab60260a-14a7-4c38-8d29-d78804a53616",
  accountId: "acct_sandboxFixture",
  amountCents: 65_000,
  expiresAtSeconds: 1_800_007_200,
  returnPath: "/nordic/app/sales?booking=fixture&step=payment",
};
const sessionId = "cs_test_fixture";
const hostedUrl = `https://checkout.stripe.com/g/pay/${sessionId}#fixture`;
const open = {
  id: sessionId,
  object: "checkout.session",
  livemode: false,
  mode: "payment",
  client_reference_id: attempt.id,
  amount_total: attempt.amountCents,
  currency: "dkk",
  expires_at: attempt.expiresAtSeconds,
  payment_method_types: ["card"],
  status: "open",
  payment_status: "unpaid",
  url: hostedUrl,
};

test("checkout retries send the same amount and idempotency key on the connected account", async () => {
  const requests: Request[] = [];
  const stripe = stripeCheckoutSandbox(config, async (input, init) => {
    requests.push(new Request(input, init));
    return requests.length === 1 ? new Response(null, { status: 503 }) : Response.json(open);
  });
  await assert.rejects(() => stripe.create(attempt), /temporarily unavailable/);
  assert.deepEqual(await stripe.create(attempt), { id: sessionId, state: "open", url: hostedUrl });
  const bodies = await Promise.all(requests.map(async (request) => {
    assert.equal(request.url, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(request.method, "POST");
    assert.equal(request.headers.get("Stripe-Account"), attempt.accountId);
    assert.equal(request.headers.get("Idempotency-Key"), attempt.id);
    assert.equal(request.redirect, "error");
    return Object.fromEntries(new URLSearchParams(await request.text()));
  }));
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(bodies[0], {
    mode: "payment",
    "allowed_payment_method_types[0]": "card",
    "adaptive_pricing[enabled]": "false",
    client_reference_id: attempt.id,
    expires_at: String(attempt.expiresAtSeconds),
    success_url: config.origin + attempt.returnPath,
    cancel_url: config.origin + attempt.returnPath,
    "line_items[0][price_data][currency]": "dkk",
    "line_items[0][price_data][unit_amount]": String(attempt.amountCents),
    "line_items[0][price_data][product_data][name]": "Appointment checkout",
    "line_items[0][quantity]": "1",
  });
});

test("only a successful checkout return asks Waybook to check payment automatically", async () => {
  const stripe = stripeCheckoutSandbox(config, async (input, init) => {
    const body = new URLSearchParams(await new Request(input, init).text());
    assert.equal(body.get("success_url"), config.origin + attempt.returnPath + "&stripe=return");
    assert.equal(body.get("cancel_url"), config.origin + attempt.returnPath);
    return Response.json(open);
  });
  await stripe.create({ ...attempt, returnPath: attempt.returnPath + "&stripe=return" });
});

test("retrieval distinguishes paid, expired and processing sessions", async () => {
  const cases = [
    [{ status: "complete", payment_status: "paid", payment_intent: "pi_fixture" },
      { id: sessionId, state: "paid", paymentIntentId: "pi_fixture" }],
    [{ status: "expired" }, { id: sessionId, state: "expired" }],
    [{ status: "complete" }, { id: sessionId, state: "processing" }],
  ] as const;
  for (const [details, expected] of cases) {
    const stripe = stripeCheckoutSandbox(config, async (input, init) => {
      const request = new Request(input, init);
      assert.equal(request.method, "GET");
      assert.equal(request.url, `https://api.stripe.com/v1/checkout/sessions/${sessionId}`);
      assert.equal(request.headers.get("Stripe-Account"), attempt.accountId);
      return Response.json({ ...open, url: null, ...details });
    });
    assert.deepEqual(await stripe.retrieve(attempt, sessionId), expected);
  }
});

test("expired attempt recovery finds and verifies the original session across pages", async () => {
  const cursors: (string | null)[] = [];
  const stripe = stripeCheckoutSandbox(config, async (input, init) => {
    const request = new Request(input, init);
    const query = new URL(request.url).searchParams;
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("Stripe-Account"), attempt.accountId);
    assert.equal(query.get("created[gte]"), "1799999880");
    assert.equal(query.get("created[lte]"), "1800007320");
    const cursor = query.get("starting_after");
    cursors.push(cursor);
    const unrelated = { ...open, id: "cs_test_other", client_reference_id: "other-attempt" };
    return cursor === null
      ? Response.json({ object: "list", has_more: true, data: [unrelated] })
      : Response.json({ object: "list", has_more: false, data: [
        { ...open, status: "complete", payment_status: "paid", payment_intent: "pi_fixture", url: null },
      ] });
  });
  assert.deepEqual(await stripe.findAfterExpiry(attempt), { id: sessionId, state: "paid", paymentIntentId: "pi_fixture" });
  assert.deepEqual(cursors, [null, "cs_test_other"]);
});

test("expired attempt recovery fails closed on ambiguous or unverified results", async () => {
  const list = (data: unknown[], hasMore = false) => stripeCheckoutSandbox(config, async () =>
    Response.json({ object: "list", has_more: hasMore, data }));
  assert.equal(await list([]).findAfterExpiry(attempt), null);
  await assert.rejects(list([open, { ...open, id: "cs_test_duplicate" }]).findAfterExpiry(attempt), /more than one/);
  await assert.rejects(list([{ ...open, amount_total: 1 }]).findAfterExpiry(attempt), /expected sandbox checkout session/);
  await assert.rejects(list([], true).findAfterExpiry(attempt), /could not confirm/);
});

test("lookup identifies the Checkout Session for a single connected payment intent", async () => {
  const session = { ...open, status: "complete", payment_status: "paid", payment_intent: "pi_fixture" };
  const page = { object: "list", has_more: false, data: [session] };
  const stripe = stripeCheckoutSandbox(config, async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.url, "https://api.stripe.com/v1/checkout/sessions?payment_intent=pi_fixture&limit=2");
    assert.equal(request.method, "GET");
    assert.equal(request.headers.get("Stripe-Account"), attempt.accountId);
    assert.equal(request.headers.get("Idempotency-Key"), null);
    return Response.json(page);
  });
  assert.deepEqual(await stripe.findByPaymentIntent(attempt.accountId, "pi_fixture"), { id: sessionId, attemptId: attempt.id });

  for (const details of [
    { data: [session, { ...session, id: "cs_test_other" }] },
    { has_more: true },
    { data: [null] },
    { data: [{ ...session, livemode: true }] },
    { data: [{ ...session, payment_intent: "pi_other" }] },
  ]) {
    const unexpected = stripeCheckoutSandbox(config, async () => Response.json({ ...page, ...details }));
    await assert.rejects(() => unexpected.findByPaymentIntent(attempt.accountId, "pi_fixture"), /Stripe/);
  }
  const unrelated = stripeCheckoutSandbox(config, async () => Response.json({ ...page, data: [] }));
  assert.equal(await unrelated.findByPaymentIntent(attempt.accountId, "pi_fixture"), null);
});

test("checkout rejects mismatched sessions, forged redirects and contradictory outcomes", async () => {
  for (const details of [
    { id: "cs_live_fixture" }, { id: "cs_test_unrelated" }, { livemode: true },
    { object: "payment_intent" }, { mode: "setup" }, { client_reference_id: "another-attempt" },
    { amount_total: attempt.amountCents - 1 }, { currency: "eur" }, { expires_at: 1 },
    { payment_method_types: ["card", "link"] },
    { url: "https://checkout.stripe.com.example/c/pay/cs_test_fixture" },
    { url: "https://fake@checkout.stripe.com/c/pay/cs_test_fixture" },
    { url: "https://checkout.stripe.com/c/pay/cs_test_unrelated" },
    { status: "open", payment_status: "paid", payment_intent: "pi_fixture" },
    { status: "complete", payment_status: "paid", payment_intent: null },
    { status: "complete", payment_status: "no_payment_required" },
    { status: "expired", payment_status: "paid", payment_intent: "pi_fixture" },
  ]) {
    const stripe = stripeCheckoutSandbox(config, async () => Response.json({ ...open, ...details }));
    await assert.rejects(() => stripe.retrieve(attempt, sessionId), /Stripe/);
  }
});

test("invalid credentials, session paths, and return destinations never reach Stripe", async () => {
  const request: typeof fetch = async () => assert.fail("Invalid context reached Stripe");
  const stripe = stripeCheckoutSandbox(config, request);
  assert.throws(() => stripe.create({ ...attempt, returnPath: "//elsewhere.example/" }), /return address/);
  await assert.rejects(() => stripe.retrieve(attempt, "cs_test_fixture/expire"), /checkout context/);
  await assert.rejects(() => stripe.create({ ...attempt, amountCents: 0 }), /checkout context/);
  const live = stripeCheckoutSandbox({ ...config, secretKey: "sk_live_fixture" }, request);
  await assert.rejects(() => live.create(attempt), /checkout context/);
});

test("a payment that completes during expiration is still returned as paid", async () => {
  const path = `https://api.stripe.com/v1/checkout/sessions/${sessionId}`;
  const requests: string[] = [];
  const stripe = stripeCheckoutSandbox(config, async (input, init) => {
    const request = new Request(input, init);
    requests.push(`${request.method} ${request.url}`);
    assert.equal(request.headers.get("Stripe-Account"), attempt.accountId);
    if (request.method === "POST") return new Response(null, { status: 400 });
    if (requests.length === 1) return Response.json(open);
    return Response.json({ ...open, status: "complete", payment_status: "paid", payment_intent: "pi_race", url: null });
  });
  assert.deepEqual(await stripe.expire(attempt, sessionId), { id: sessionId, state: "paid", paymentIntentId: "pi_race" });
  assert.deepEqual(requests, [`GET ${path}`, `POST ${path}/expire`, `GET ${path}`]);
});

test("expiration needs provider confirmation before it can release the balance", async () => {
  const unresolved = stripeCheckoutSandbox(config, async (_input, init) =>
    init?.method === "POST" ? new Response(null, { status: 503 }) : Response.json(open));
  await assert.rejects(() => unresolved.expire(attempt, sessionId), /could not close/);

  const confirmed = stripeCheckoutSandbox(config, async (_input, init) =>
    Response.json(init?.method === "POST" ? { ...open, status: "expired", url: null } : open));
  assert.deepEqual(await confirmed.expire(attempt, sessionId), { id: sessionId, state: "expired" });
});

test("saved-card checkout binds the customer on create and on reconciliation", async () => {
  const savedAttempt = { ...attempt, stripeCustomerId: "cus_expected" };
  const requests: Request[] = [];
  const stripe = stripeCheckoutSandbox(config, async (url, init) => {
    const request = new Request(url, init);
    requests.push(request);
    if (request.method === "POST") {
      const body = new URLSearchParams(await request.text());
      assert.equal(body.get("customer"), savedAttempt.stripeCustomerId);
      assert.equal(request.headers.get("Idempotency-Key"), savedAttempt.id);
      assert.equal(request.headers.get("Stripe-Account"), savedAttempt.accountId);
      assert.equal(body.has("saved_payment_method_options[allow_redisplay_filters][0]"), false);
      return Response.json({ ...open, customer: savedAttempt.stripeCustomerId });
    }
    return Response.json({ ...open, customer: "cus_unrelated" });
  });
  assert.equal((await stripe.create(savedAttempt)).state, "open");
  await assert.rejects(stripe.retrieve(savedAttempt, sessionId), /expected sandbox checkout session/);
  assert.equal(requests.length, 2);
});
