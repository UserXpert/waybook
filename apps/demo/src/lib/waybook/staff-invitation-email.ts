import "server-only";

import { createHmac } from "node:crypto";
import { sendWithResend } from "./resend-delivery";
import { isResendOnboardingTestSender } from "./resend-onboarding-test";

export function staffInvitationEmailConfig() {
  const apiKey = process.env.WAYBOOK_STAFF_INVITE_RESEND_API_KEY?.trim();
  const sender = process.env.WAYBOOK_STAFF_INVITE_FROM?.trim();
  const secret = process.env.WAYBOOK_STAFF_INVITE_SECRET?.trim();
  const domain = process.env.WAYBOOK_STAFF_INVITE_ORIGIN?.trim();
  if (!apiKey || !sender || !secret || secret.length < 32 || !domain) return null;
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(sender) || isResendOnboardingTestSender(sender)) return null;
  try {
    const url = new URL(domain);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return null;
    return { apiKey, sender, secret, origin: url.origin };
  } catch {
    return null;
  }
}

export type StaffInvitationEmailConfig = NonNullable<ReturnType<typeof staffInvitationEmailConfig>>;
export type InvitationEmailSnapshot = {
  id: string;
  sendNumber: number;
  email: string;
  emailStartedAt: Date;
  emailSender: string;
  emailOrigin: string;
  emailWorkspaceName: string;
};

export function staffRequestInvitationToken(secret: string, tenantId: string, requestId: string, sendNumber = 0) {
  const suffix = sendNumber ? `:${sendNumber}` : "";
  return createHmac("sha256", secret).update(`waybook-staff-email:${tenantId}:${requestId}${suffix}`).digest("base64url");
}

export function sendStaffInvitationEmail(apiKey: string, snapshot: InvitationEmailSnapshot, token: string) {
  const link = new URL(`/join?method=password#${token}`, snapshot.emailOrigin).href;
  return sendWithResend({
    apiKey,
    idempotencyKey: snapshot.sendNumber ? `waybook-staff-invite/${snapshot.id}/${snapshot.sendNumber}` : `waybook-staff-invite/${snapshot.id}`,
    firstAttemptAt: snapshot.emailStartedAt,
    message: {
      from: snapshot.emailSender,
      to: snapshot.email,
      subject: "Your Waybook staff invitation",
      text: `Your workspace owner invited you to join ${snapshot.emailWorkspaceName} on Waybook.\n\nSet your password using this one-time link:\n${link}\n\nThe link expires 48 hours after issue. If you weren’t expecting this invitation, you can ignore this email.`,
    },
  });
}
