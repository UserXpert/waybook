import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { readStripeSandboxNotification } from "./stripe-sandbox-webhook";

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
const sign = (bytes: Uint8Array, time = now) =>
  createHmac("sha256", secret).update(`${time}.`).update(bytes).digest("hex");

test("Stripe webhook verifies exact bytes and accepts a valid v1 signature during rotation", () => {
  const bytes = Buffer.from(JSON.stringify({ ...event, fixture: "é" }) + "\n");
  const signed = `t=${now},v1=${"0".repeat(64)},v1=${sign(bytes)}`;
  assert.deepEqual(readStripeSandboxNotification(bytes, signed, secret, now), { kind: "checkout", accountId, attemptId, sessionId });
  assert.throws(() => readStripeSandboxNotification(bytes.subarray(0, -1), signed, secret, now), /signature/);
  assert.throws(() => readStripeSandboxNotification(bytes, signed, "whsec_other", now), /signature/);
  assert.throws(() => readStripeSandboxNotification(bytes, `t=${now},v0=${sign(bytes)}`, secret, now), /signature/);
});

test("Stripe webhook rejects old, future, or ambiguous signing timestamps", () => {
  const bytes = Buffer.from(JSON.stringify(event));
  for (const time of [now - 301, now + 301]) {
    assert.throws(() => readStripeSandboxNotification(bytes, `t=${time},v1=${sign(bytes, time)}`, secret, now), /timestamp/);
  }
  assert.throws(() => readStripeSandboxNotification(bytes, `t=${now},t=${now},v1=${sign(bytes)}`, secret, now), /timestamp/);
});

test("Stripe webhook extracts only supported sandbox Connect checkout events", () => {
  for (const type of ["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.expired"]) {
    const bytes = Buffer.from(JSON.stringify({ ...event, type }));
    assert.deepEqual(readStripeSandboxNotification(bytes, `t=${now},v1=${sign(bytes)}`, secret, now), { kind: "checkout", accountId, attemptId, sessionId });
  }
  for (const other of [
    { ...event, livemode: true }, { ...event, account: null }, { ...event, type: "payment_intent.succeeded" },
    { ...event, data: { object: { ...snapshot, livemode: true } } },
    { ...event, data: { object: { ...snapshot, client_reference_id: "external-reference" } } },
    { ...event, data: { object: { ...snapshot, id: "cs_live_fixture" } } },
  ]) {
    const bytes = Buffer.from(JSON.stringify(other));
    assert.equal(readStripeSandboxNotification(bytes, `t=${now},v1=${sign(bytes)}`, secret, now), null);
  }
});

test("Stripe refund events require a sandbox connected account and Waybook refund reference", () => {
  const refundId = "re_fixture";
  const refund = { object: "refund", id: refundId, metadata: { waybook_refund_attempt: attemptId } };
  const parse = (value: object) => {
    const bytes = Buffer.from(JSON.stringify(value));
    return readStripeSandboxNotification(bytes, `t=${now},v1=${sign(bytes)}`, secret, now);
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
