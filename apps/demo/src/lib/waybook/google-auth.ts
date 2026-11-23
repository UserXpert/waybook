import "server-only";

import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { google } from "better-auth/social-providers";
import { Pool } from "pg";
import { controlDatabaseUrl, controlDb } from "./database";

export const googleCallbackPath = "/api/auth/callback/google";
export const googleFinishPath = "/auth/google/finish";
export function googleInvitationCookie(attempt: string) {
  return `waybook_google_invitation_${attempt}`;
}

function googleSettings() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  const baseURL = process.env.BETTER_AUTH_URL?.trim();
  if (!clientId || !clientSecret || !secret || secret.length < 32 || !baseURL) return null;
  try {
    const url = new URL(baseURL);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
    return { clientId, clientSecret, secret, origin: url.origin };
  } catch {
    return null;
  }
}

function makeGoogleAuth(settings: NonNullable<ReturnType<typeof googleSettings>>) {
  const database = new URL(controlDatabaseUrl);
  const local = database.hostname === "127.0.0.1" || database.hostname === "localhost";
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) database.searchParams.delete(key);
  const pool = new Pool({
    connectionString: database.href,
    ssl: local ? false : { rejectUnauthorized: true },
    max: 3,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 15_000,
  });
  const providerOptions = { clientId: settings.clientId, clientSecret: settings.clientSecret, prompt: "select_account" as const };
  const provider = google(providerOptions);
  return betterAuth({
    baseURL: settings.origin,
    secret: settings.secret,
    database: pool,
    advanced: { cookiePrefix: "waybook_oauth", useSecureCookies: settings.origin.startsWith("https:") },
    emailAndPassword: { enabled: false },
    socialProviders: {
      google: {
        ...providerOptions,
        async getUserInfo(tokens) {
          const result = await provider.getUserInfo(tokens);
          return result?.user.emailVerified === true ? result : null;
        },
      },
    },
    user: { modelName: "waybook_oauth_users" },
    session: {
      modelName: "waybook_oauth_sessions",
      expiresIn: 10 * 60,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    account: {
      modelName: "waybook_oauth_accounts",
      accountLinking: { enabled: false },
      updateAccountOnSignIn: false,
    },
    verification: { modelName: "waybook_oauth_verifications" },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => ({
            data: { ...account, accessToken: null, refreshToken: null, idToken: null },
          }),
        },
      },
    },
    onAPIError: { errorURL: "/login?google=denied" },
    plugins: [nextCookies()],
  });
}

const authState = globalThis as typeof globalThis & {
  waybookGoogleAuth?: ReturnType<typeof makeGoogleAuth>;
};

export function getGoogleAuth() {
  const settings = googleSettings();
  if (!settings) return null;
  authState.waybookGoogleAuth ??= makeGoogleAuth(settings);
  return { auth: authState.waybookGoogleAuth, origin: settings.origin };
}

/** Old Control schemas and unconfigured environments keep password sign-in. */
export async function googleSignInAvailable() {
  if (!googleSettings()) return false;
  try {
    const [schema] = await controlDb<{ available: boolean }[]>`
      SELECT to_regclass('public.waybook_staff_invitations') IS NOT NULL
         AND to_regclass('public.waybook_oauth_sessions') IS NOT NULL AS available
    `;
    return schema?.available === true;
  } catch {
    console.error("Google sign-in availability could not be checked.");
    return false;
  }
}
