import assert from "node:assert/strict";
import test from "node:test";
import { sendWithResend } from "./resend-delivery.ts";

const request = { apiKey: "test-key", idempotencyKey: "outbox/one", firstAttemptAt: new Date("2030-01-01T00:00:00Z"), now: new Date("2030-01-01T01:00:00Z"), message: { from: "studio@example.invalid", to: "client@example.invalid", subject: "Booking", text: "Confirmed" } };

test("Resend adapter sends one stable request and records only provider acceptance", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "outbox/one");
    assert.deepEqual(JSON.parse(String(init?.body)), { from: request.message.from, to: [request.message.to], subject: "Booking", text: "Confirmed" });
    return Response.json({ id: "provider-id" });
  };
  assert.deepEqual(await sendWithResend({ ...request, fetcher }), { kind: "accepted", providerId: "provider-id" });
  assert.equal(calls, 1);
});

test("Resend adapter classifies uncertain, retryable and permanent outcomes", async () => {
  const respond = (body: unknown, status: number, headers?: HeadersInit): typeof fetch => async () => Response.json(body, { status, headers });
  assert.deepEqual(await sendWithResend({ ...request, fetcher: async () => { throw Error("sensitive transport details"); } }), { kind: "retry" });
  assert.deepEqual(await sendWithResend({ ...request, fetcher: respond({}, 429, { "retry-after": "30" }) }), { kind: "retry", retryAfterSeconds: 30 });
  assert.deepEqual(await sendWithResend({ ...request, fetcher: respond({ name: "concurrent_idempotent_requests" }, 409) }), { kind: "retry" });
  assert.deepEqual(await sendWithResend({ ...request, fetcher: respond({ name: "invalid_idempotent_request" }, 409) }), { kind: "review" });
  assert.deepEqual(await sendWithResend({ ...request, fetcher: respond({}, 403) }), { kind: "rejected" });
  assert.deepEqual(await sendWithResend({ ...request, fetcher: respond({}, 200) }), { kind: "review" });
});

test("Resend adapter never retries outside its safe window or sends invalid headers", async () => {
  const fetcher: typeof fetch = async () => { throw Error("must not send"); };
  assert.deepEqual(await sendWithResend({ ...request, now: new Date("2030-01-02T00:00:00Z"), fetcher }), { kind: "review" });
  assert.deepEqual(await sendWithResend({ ...request, message: { ...request.message, subject: "Hello\nBcc: other" }, fetcher }), { kind: "rejected" });
});
