import "server-only";

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { controlDb } from "./database";

const SESSION_COOKIE = "waybook_session";

export type Identity = { id: string; email: string; displayName: string; isPlatformAdmin: boolean };

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
/** Creates the format consumed by passwordMatches. Keep password creation on the
 * server so neither salts nor password hashes are ever exposed to a client. */
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
function passwordMatches(password: string, stored: string) {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 64).toString("hex");
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export async function currentIdentity(): Promise<Identity | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const rows = await controlDb<Identity[]>`
    SELECT i.id, i.email, i.display_name AS "displayName", i.is_platform_admin AS "isPlatformAdmin"
    FROM sessions s JOIN identities i ON i.id = s.identity_id
    WHERE s.token_hash = ${hash(token)} AND s.revoked_at IS NULL AND s.expires_at > now()
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function signIn(email: string, password: string) {
  const rows = await controlDb<Array<Identity & { passwordHash: string }>>`
    SELECT id, email, display_name AS "displayName", is_platform_admin AS "isPlatformAdmin", password_hash AS "passwordHash"
    FROM identities WHERE email = ${email.toLowerCase().trim()} LIMIT 1
  `;
  const identity = rows[0];
  if (!identity || !passwordMatches(password, identity.passwordHash)) return false;
  const token = randomBytes(32).toString("base64url");
  await controlDb`INSERT INTO sessions (identity_id, token_hash, expires_at) VALUES (${identity.id}, ${hash(token)}, now() + interval '12 hours')`;
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
  return true;
}

export async function signOut() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await controlDb`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${hash(token)}`;
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function requireIdentity() {
  const identity = await currentIdentity();
  if (!identity) redirect("/login");
  return identity;
}
