const encoder = new TextEncoder();
const maxAgeMs = 15 * 60_000;

export function bookingEmbedOrigin(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const allowedProtocol = url.protocol === "https:" || (url.protocol === "http:" && url.hostname === "localhost");
    return allowedProtocol && url.origin === value ? value : null;
  } catch {
    return null;
  }
}

async function signingKey() {
  const secret = process.env.WAYBOOK_EMBED_SIGNING_SECRET || (process.env.NODE_ENV === "development" ? "waybook-local-embed-secret" : "");
  return secret ? crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]) : null;
}

function framePayload(tenantRoute: string, source: string, issuedAt: string) {
  return encoder.encode(JSON.stringify(["booking-frame", tenantRoute, source, issuedAt]));
}

export async function signBookingFrame(tenantRoute: string, source: string) {
  const key = await signingKey();
  if (!key) return null;
  const issuedAt = String(Date.now());
  const signature = await crypto.subtle.sign("HMAC", key, framePayload(tenantRoute, source, issuedAt));
  const encoded = btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll("+", "-").replaceAll("/", "_").replace(/=$/, "");
  return `${issuedAt}.${encoded}`;
}

export async function verifyBookingFrame(tenantRoute: string, source: string, grant: string) {
  const match = /^(\d{13})\.([\w-]{43})$/.exec(grant);
  if (!match || Math.abs(Date.now() - Number(match[1])) > maxAgeMs) return false;
  const key = await signingKey();
  if (!key) return false;
  const signature = Uint8Array.from(atob(match[2].replaceAll("-", "+").replaceAll("_", "/") + "="), (byte) => byte.charCodeAt(0));
  return crypto.subtle.verify("HMAC", key, signature, framePayload(tenantRoute, source, match[1]));
}
