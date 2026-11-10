import assert from "node:assert/strict";
import test from "node:test";
import { hasMatchingRequestOrigin } from "./request-origin.ts";

test("management requests must match the public host and protocol", () => {
  assert.equal(hasMatchingRequestOrigin("http://localhost:38479", "localhost:38479", "http:"), true);
  assert.equal(hasMatchingRequestOrigin("https://book.example", "book.example", "https:"), true);
  assert.equal(hasMatchingRequestOrigin("https://other.example", "book.example", "https:"), false);
  assert.equal(hasMatchingRequestOrigin("http://book.example", "book.example", "https:"), false);
  assert.equal(hasMatchingRequestOrigin("null", "book.example", "https:"), false);
  assert.equal(hasMatchingRequestOrigin("https://book.example", "evil@book.example", "https:"), false);
});
