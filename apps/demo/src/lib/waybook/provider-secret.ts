import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type ProviderSecretEnvelope = { version: 1; keyId: string; nonce: string; ciphertext: string; tag: string };
export type ProviderSecretContext = { tenantId: string; connectionId: string; provider: string };
export type ProviderSecretKey = { id: string; key: Buffer };

function validateKey(key: ProviderSecretKey) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key.id) || key.key.length !== 32) throw new Error("Provider encryption key is invalid.");
}
function associatedData(context: ProviderSecretContext): Buffer {
  if (!context.tenantId || !context.connectionId || !context.provider) throw new Error("Provider secret context is invalid.");
  return Buffer.from(JSON.stringify(["waybook-provider-secret", 1, context.tenantId, context.connectionId, context.provider]), "utf8");
}
function decode(value: string, expectedLength?: number): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Provider secret envelope is invalid.");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || (expectedLength !== undefined && bytes.length !== expectedLength)) throw new Error("Provider secret envelope is invalid.");
  return bytes;
}

/** Encrypt with a key supplied by server configuration, never by the tenant database. */
export function encryptProviderSecret(secret: string, context: ProviderSecretContext, key: ProviderSecretKey): ProviderSecretEnvelope {
  validateKey(key);
  if (!secret || Buffer.byteLength(secret, "utf8") > 4096) throw new Error("Provider credential is invalid.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, nonce);
  cipher.setAAD(associatedData(context));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return { version: 1, keyId: key.id, nonce: nonce.toString("base64url"), ciphertext: ciphertext.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

/** The key resolver can retain old key IDs during a deliberate key rotation. */
export function decryptProviderSecret(envelope: ProviderSecretEnvelope, context: ProviderSecretContext, resolveKey: (id: string) => Buffer | undefined): string {
  if (!envelope || envelope.version !== 1 || typeof envelope.keyId !== "string") throw new Error("Provider secret envelope is invalid.");
  const key = resolveKey(envelope.keyId);
  if (!key) throw new Error("Provider encryption key is unavailable.");
  validateKey({ id: envelope.keyId, key });
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, decode(envelope.nonce, 12));
    decipher.setAAD(associatedData(context));
    decipher.setAuthTag(decode(envelope.tag, 16));
    const plaintext = Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]);
    if (!plaintext.length || plaintext.length > 4096) throw new Error("Invalid plaintext.");
    return plaintext.toString("utf8");
  } catch {
    // Never expose credentials or cryptographic internals in a user-facing error.
    throw new Error("Provider credential could not be decrypted.");
  }
}
