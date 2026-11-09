import { createHmac, timingSafeEqual } from "node:crypto";

const maxAgeMs = 15 * 60_000;
const secret = () => process.env.WAYBOOK_EMBED_SIGNING_SECRET || (process.env.NODE_ENV === "development" ? "waybook-local-embed-secret" : "");

export function signEmbedSource(tenantId: string, source: string) {
  const key = secret();
  if (!key) return null;
  const issuedAt = Date.now().toString(36);
  const payload = `${tenantId}.${source}.${issuedAt}`;
  return `${issuedAt}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
}

export function verifyEmbedSource(tenantId: string, source: string, token: string) {
  const key = secret();
  const [issuedAt, signature] = token.split(".");
  if (!key || !issuedAt || !signature) return false;
  const issuedAtMs = Number.parseInt(issuedAt, 36);
  if (!Number.isFinite(issuedAtMs) || Math.abs(Date.now() - issuedAtMs) > maxAgeMs) return false;
  const expected = createHmac("sha256", key).update(`${tenantId}.${source}.${issuedAt}`).digest("base64url");
  return signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
