import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decryptProviderSecret, encryptProviderSecret } from "./provider-secret.ts";

test("provider credentials are encrypted and bound to tenant and connection", () => {
  const key = { id: "key-1", key: randomBytes(32) };
  const context = { tenantId: "tenant-a", connectionId: "connection-a", provider: "resend" };
  const first = encryptProviderSecret("example-api-key", context, key);
  const second = encryptProviderSecret("example-api-key", context, key);
  assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(decryptProviderSecret(first, context, () => key.key), "example-api-key");
  assert.throws(() => decryptProviderSecret(first, { ...context, tenantId: "tenant-b" }, () => key.key), /could not be decrypted/);
  assert.throws(() => decryptProviderSecret(first, { ...context, connectionId: "other" }, () => key.key), /could not be decrypted/);
  assert.throws(() => decryptProviderSecret({ ...first, ciphertext: first.ciphertext.slice(0, -1) + (first.ciphertext.endsWith("A") ? "B" : "A") }, context, () => key.key), /could not be decrypted/);
  assert.throws(() => decryptProviderSecret(first, context, () => undefined), /unavailable/);
});

test("provider credential encryption rejects invalid keys and oversized secrets", () => {
  const context = { tenantId: "tenant", connectionId: "connection", provider: "resend" };
  assert.throws(() => encryptProviderSecret("secret", context, { id: "invalid key", key: randomBytes(32) }), /invalid/);
  assert.throws(() => encryptProviderSecret("secret", context, { id: "one", key: randomBytes(31) }), /invalid/);
  assert.throws(() => encryptProviderSecret("x".repeat(4097), context, { id: "one", key: randomBytes(32) }), /invalid/);
});
