import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { readStripePaymentNotification } from "./stripe-sandbox-webhook";

const secret = "whsec_fixture";
const now = 1_800_007_200;
const accountId = "acct_fixture";
const sessionId = "cs_test_fixture";
const attemptId = "ab60260a-14a7-4c38-8d29-d78804a53616";
const snapshot = {
  object: "checkout.session", id: sessionId, livemode: false, client_reference_id: attemptId,
};
const event = {
  object: "event", id: "evt_fixture", livemode: false, type: "checkout.session.completed", account: accountId,
  data: { object: snapshot },
};
const sign = (bytes: Uint8Array, time = now, signingSecret = secret) =>
  createHmac("sha256", signingSecret).update(`${time}.`).update(bytes).digest("hex");

test("Stripe webhook verifies exact bytes and accepts a valid v1 signature during rotation", () => {
  const bytes = Buffer.from(JSON.stringify({ ...event, fixture: "é" }) + "\n");
  const signed = `t=${now},v1=${"0".repeat(64)},v1=${sign(bytes)}`;
  assert.deepEqual(readStripePaymentNotification(bytes, signed, secret, false, now), { kind: "checkout", accountId, attemptId, sessionId });
  assert.throws(() => readStripePaymentNotification(bytes.subarray(0, -1), signed, secret, false, now), /signature/);
  assert.throws(() => readStripePaymentNotification(bytes, signed, "whsec_other", false, now), /signature/);
  assert.throws(() => readStripePaymentNotification(bytes, `t=${now},v0=${sign(bytes)}`, secret, false, now), /signature/);
});

test("Stripe webhook rejects old, future, or ambiguous signing timestamps", () => {
  const bytes = Buffer.from(JSON.stringify(event));
  for (const time of [now - 301, now + 301]) {
    assert.throws(() => readStripePaymentNotification(bytes, `t=${time},v1=${sign(bytes, time)}`, secret, false, now), /timestamp/);
  }
  assert.throws(() => readStripePaymentNotification(bytes, `t=${now},t=${now},v1=${sign(bytes)}`, secret, false, now), /timestamp/);
});

test("Stripe webhook extracts only supported sandbox Connect checkout events", () => {
  for (const type of ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"]) {
    const bytes = Buffer.from(JSON.stringify({ ...event, type }));
    assert.deepEqual(readStripePaymentNotification(bytes, `t=${now},v1=${sign(bytes)}`, secret, false, now), { kind: "checkout", accountId, attemptId, sessionId });
  }
  for (const other of [
    { ...event, livemode: true }, { ...event, account: null }, { ...event, type: "payment_intent.succeeded" },
    { ...event, data: { object: { ...snapshot, livemode: true } } },
    { ...event, data: { object: { ...snapshot, client_reference_id: "external-reference" } } },
    { ...event, data: { object: { ...snapshot, id: "cs_live_fixture" } } },
  ]) {
    const bytes = Buffer.from(JSON.stringify(other));
    assert.equal(readStripePaymentNotification(bytes, `t=${now},v1=${sign(bytes)}`, secret, false, now), null);
  }
});

test("Stripe refund events require a sandbox connected account and Waybook refund reference", () => {
  const refundId = "re_fixture";
  const refund = { object: "refund", id: refundId, metadata: { waybook_refund_attempt: attemptId } };
  const parse = (value: object) => {
    const bytes = Buffer.from(JSON.stringify(value));
    return readStripePaymentNotification(bytes, `t=${now},v1=${sign(bytes)}`, secret, false, now);
  };
  for (const type of ["refund.created", "refund.updated", "refund.failed"]) {
    assert.deepEqual(parse({ ...event, type, data: { object: refund } }), { kind: "refund", accountId, attemptId, refundId });
  }
  const created = { ...event, type: "refund.created", data: { object: refund } };
  assert.equal(parse({ ...created, livemode: true }), null);
  assert.equal(parse({ ...created, account: null }), null);
  assert.equal(parse({ ...created, data: { object: { ...refund, metadata: {} } } }), null);
  assert.equal(parse({ ...created, data: { object: { ...refund, livemode: true } } }), null);
  assert.equal(parse({ ...created, type: "charge.refunded" }), null);
});

test("Stripe Dashboard refund events identify an original payment without a Waybook request", () => {
  const resource = { object: "refund", id: "re_dashboard", currency: "dkk", payment_intent: "pi_fixture", amount: 503 };
  const parse = (object: object) => {
    const bytes = Buffer.from(JSON.stringify({ ...event, type: "refund.created", data: { object } }));
    return readStripePaymentNotification(bytes, `t=${now},v1=${sign(bytes)}`, secret, false, now);
  };
  assert.deepEqual(parse(resource), { kind: "dashboard-refund", accountId, refundId: resource.id,
    paymentIntentId: resource.payment_intent, amountCents: resource.amount });
  assert.equal(parse({ ...resource, payment_intent: null }), null);
  assert.equal(parse({ ...resource, amount: 0 }), null);
  assert.equal(parse({ ...resource, currency: "usd" }), null);
  assert.equal(parse({ ...resource, metadata: { waybook_refund_attempt: "malformed" } }), null);
});

test("Stripe webhook separates live checkout signatures, event mode, object mode and session IDs", () => {
  const liveSecret = "whsec_livefixture";
  const liveSessionId = "cs_live_fixture";
  const liveSnapshot = { ...snapshot, id: liveSessionId, livemode: true };
  const liveEvent = { ...event, livemode: true, data: { object: liveSnapshot } };
  const parseLive = (value: object) => {
    const bytes = Buffer.from(JSON.stringify(value));
    return readStripePaymentNotification(bytes, `t=${now},v1=${sign(bytes, now, liveSecret)}`, liveSecret, true, now);
  };

  assert.deepEqual(parseLive(liveEvent), { kind: "checkout", accountId, attemptId, sessionId: liveSessionId });
  assert.equal(parseLive(event), null);
  assert.equal(parseLive({ ...liveEvent, livemode: undefined }), null);
  assert.equal(parseLive({ ...liveEvent, data: { object: { ...liveSnapshot, livemode: false } } }), null);
  assert.equal(parseLive({ ...liveEvent, data: { object: { ...liveSnapshot, livemode: undefined } } }), null);
  assert.equal(parseLive({ ...liveEvent, data: { object: { ...liveSnapshot, id: sessionId } } }), null);

  const bytes = Buffer.from(JSON.stringify(liveEvent));
  const liveSignature = `t=${now},v1=${sign(bytes, now, liveSecret)}`;
  assert.equal(readStripePaymentNotification(bytes, liveSignature, liveSecret, undefined, now), null);
  assert.throws(() => readStripePaymentNotification(bytes, liveSignature, secret, false, now), /signature/);
  assert.throws(() => readStripePaymentNotification(bytes, `t=${now},v1=${sign(bytes)}`, liveSecret, true, now), /signature/);
});

test("Live Stripe refund snapshots allow omitted object mode and reject a conflicting mode", () => {
  const refund = { object: "refund", id: "re_fixture", metadata: { waybook_refund_attempt: attemptId } };
  const dashboardRefund = { object: "refund", id: "re_dashboard", currency: "dkk", payment_intent: "pi_fixture", amount: 503 };
  const parseLiveRefund = (resource: object, type = "refund.created") => {
    const bytes = Buffer.from(JSON.stringify({ ...event, livemode: true, type, data: { object: resource } }));
    return readStripePaymentNotification(bytes, `t=${now},v1=${sign(bytes)}`, secret, true, now);
  };

  assert.deepEqual(parseLiveRefund(refund), { kind: "refund", accountId, attemptId, refundId: refund.id });
  assert.deepEqual(parseLiveRefund({ ...dashboardRefund, livemode: true }), {
    kind: "dashboard-refund", accountId, refundId: dashboardRefund.id,
    paymentIntentId: dashboardRefund.payment_intent, amountCents: dashboardRefund.amount,
  });
  assert.equal(parseLiveRefund({ ...refund, livemode: false }), null);
  assert.equal(parseLiveRefund({ ...dashboardRefund, livemode: false }), null);
  assert.equal(parseLiveRefund({ object: "charge", id: "ch_fixture", livemode: true }, "charge.refunded"), null);
});
