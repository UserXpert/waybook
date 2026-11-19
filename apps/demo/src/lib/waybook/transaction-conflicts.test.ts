import test from "node:test";
import assert from "node:assert/strict";
import { BookingConflictError, SerializationRetryExhaustedError, withSerializableRetry } from "./transaction-conflicts";

test("returns a successful transaction result", async () => {
  assert.equal(await withSerializableRetry(async () => "saved"), "saved");
});

test("translates a wrapped exclusion conflict without retrying", async () => {
  let calls = 0;
  await assert.rejects(withSerializableRetry(async () => { calls++; throw { cause: { code: "23P01" } }; }), BookingConflictError);
  assert.equal(calls, 1);
});

test("retries aborted serialization and deadlock transactions", async () => {
  let calls = 0;
  const result = await withSerializableRetry(async () => {
    calls++;
    if (calls === 1) throw { code: "40001" };
    if (calls === 2) throw { cause: { code: "40P01" } };
    return "saved";
  }, { maxRetries: 2, baseDelayMs: 0 });
  assert.equal(result, "saved");
  assert.equal(calls, 3);
});

test("stops after the retry limit and does not retry unrelated errors", async () => {
  let calls = 0;
  await assert.rejects(withSerializableRetry(async () => { calls++; throw { code: "40001" }; }, { maxRetries: 2, baseDelayMs: 0 }), SerializationRetryExhaustedError);
  assert.equal(calls, 3);
  const original = new Error("unrelated failure");
  await assert.rejects(withSerializableRetry(async () => { throw original; }), (error) => error === original);
});

test("handles cyclic causes and rejects invalid retry configuration", async () => {
  const original: { cause?: unknown } = {}; original.cause = original;
  await assert.rejects(withSerializableRetry(async () => { throw original; }), (error) => error === original);
  await assert.rejects(withSerializableRetry(async () => "unused", { maxRetries: -1 }), RangeError);
});
