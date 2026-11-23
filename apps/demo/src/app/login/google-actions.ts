"use server";

import { randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getGoogleAuth, googleFinishPath, googleInvitationCookie, googleSignInAvailable } from "@/lib/waybook/google-auth";
import { isStaffInvitationToken } from "@/lib/waybook/staff-invitations";

export async function startGoogleSignIn(formData: FormData) {
  const configured = getGoogleAuth();
  const token = String(formData.get("invite") ?? "");
  if (token && !isStaffInvitationToken(token)) redirect("/login?google=denied");
  const requestHeaders = await headers();
  if (!configured || requestHeaders.get("origin") !== configured.origin || !(await googleSignInAvailable())) {
    redirect("/login?google=unavailable");
  }
  let callbackURL = googleFinishPath;
  if (token) {
    const attempt = randomBytes(16).toString("hex");
    (await cookies()).set(googleInvitationCookie(attempt), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: configured.origin.startsWith("https:"),
      path: googleFinishPath,
      maxAge: 10 * 60,
    });
    callbackURL += `?attempt=${attempt}`;
  }
  let url: string | undefined;
  try {
    const result = await configured.auth.api.signInSocial({
      headers: requestHeaders,
      body: { provider: "google", callbackURL, errorCallbackURL: "/login?google=denied", disableRedirect: true },
    });
    if (result.url) {
      const destination = new URL(result.url);
      if (destination.origin === "https://accounts.google.com") url = destination.href;
    }
  } catch {
    console.error("Google sign-in could not be started.");
  }
  redirect(url ?? "/login?google=unavailable");
}
