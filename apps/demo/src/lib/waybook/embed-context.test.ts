import assert from "node:assert/strict";
import test from "node:test";
import { validatedEmbedSource } from "./embed-context.ts";

const base = { tenantId: "tenant-a", allowedOrigins: ["https://example.test"] };
const valid = (_tenantId: string, source: string, token: string) => source === "https://example.test" && token === "signed";

test("direct bookings remain valid when both embed fields are absent", () => {
  assert.deepEqual(validatedEmbedSource({ ...base, source: undefined, token: undefined }, valid), { source: null, error: null });
});

test("partial or invalid embed contexts fail closed", () => {
  for (const input of [
    { source: "https://example.test", token: null },
    { source: null, token: "signed" },
    { source: "", token: "" },
    { source: null, token: null },
    { source: 42, token: false },
    { source: {}, token: [] },
    { source: "https://unapproved.test", token: "signed" },
    { source: "https://example.test", token: "replayed" },
  ]) assert.match(validatedEmbedSource({ ...base, ...input }, valid).error ?? "", /embedded booking session has expired/i);
});

test("a configured origin with a valid signature is attributed to the embed source", () => {
  assert.deepEqual(validatedEmbedSource({ ...base, source: "https://example.test", token: "signed" }, valid), { source: "https://example.test", error: null });
});
