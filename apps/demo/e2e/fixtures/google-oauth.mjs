// Loaded only in the disposable Playwright server. The application never imports this fixture.
import { createHash, generateKeyPairSync, sign } from "node:crypto";

if (process.env.GOOGLE_CLIENT_ID !== "waybook-e2e-google-client" ||
    process.env.BETTER_AUTH_URL !== "http://localhost:3336") {
  throw new Error("Google fixture requires the disposable Waybook E2E server.");
}
for (const name of ["CONTROL", "NORDIC_STUDIO", "COPENHAGEN_PHYSIO"]) {
  const target = new URL(process.env[`WAYBOOK_${name}_DATABASE_URL`]);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !target.pathname.startsWith("/waybook_e2e_")) {
    throw new Error("Google fixture requires disposable loopback databases.");
  }
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "waybook-e2e", use: "sig", alg: "RS256" };
const encoded = (data) => Buffer.from(JSON.stringify(data)).toString("base64url");
const originalFetch = globalThis.fetch;

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.href === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [jwk] });
  if (url.href !== "https://oauth2.googleapis.com/token") return originalFetch(input, init);
  const request = new Request(input, init);
  const body = new URLSearchParams(await request.text());
  try {
    const code = JSON.parse(Buffer.from(body.get("code"), "base64url").toString("utf8"));
    const challenge = createHash("sha256").update(body.get("code_verifier")).digest("base64url");
    if (body.get("redirect_uri") !== "http://localhost:3336/api/auth/callback/google" || challenge !== code.challenge) {
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: "https://accounts.google.com",
      aud: "waybook-e2e-google-client",
      sub: code.subject,
      email: code.email,
      email_verified: code.verified,
      name: "Waybook OAuth fixture",
      nonce: code.nonce,
      iat: now,
      exp: now + 300,
    };
    const payload = encoded({ alg: "RS256", kid: jwk.kid }) + "." + encoded(claims);
    const token = payload + "." + sign("RSA-SHA256", Buffer.from(payload), privateKey).toString("base64url");
    return Response.json({ access_token: "fixture-access-token", id_token: token, token_type: "Bearer", expires_in: 300 });
  } catch {
    return Response.json({ error: "invalid_grant" }, { status: 400 });
  }
};
