import { test } from "node:test";
import assert from "node:assert/strict";
import { providerKeyring } from "./provider-keyring.ts";
import { decryptProviderSecret, encryptProviderSecret } from "./provider-secret.ts";

test("previous provider key decrypts existing connections during rotation", () => {
  const context = { tenantId: "tenant", connectionId: "connection", provider: "resend" };
  const oldKey = { id: "old", key: Buffer.alloc(32, 1) };
  const encrypted = encryptProviderSecret("fixture credential", context, oldKey);
  const ring = providerKeyring({ activeId: "new", activeHex: Buffer.alloc(32, 2).toString("hex"), previousId: "old", previousHex: oldKey.key.toString("hex") });
  assert.ok(ring);
  assert.equal(decryptProviderSecret(encrypted, context, ring.resolve), "fixture credential");
  assert.equal(ring.active.id, "new");
  assert.equal(ring.resolve("unknown"), undefined);
});

test("invalid or ambiguous rotation configuration fails closed", () => {
  const activeHex = Buffer.alloc(32, 1).toString("hex");
  assert.equal(providerKeyring({ activeId: "old", activeHex, previousId: "old", previousHex: activeHex }), null);
  assert.equal(providerKeyring({ activeId: "new", activeHex, previousId: "old" }), null);
});
