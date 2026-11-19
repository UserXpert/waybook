/** The shared Resend sender can only be tested against an explicitly configured inbox in local development. */
export function emailVerificationRecipient(sender: string, env: NodeJS.ProcessEnv): string {
  const recipient = env.WAYBOOK_RESEND_TEST_RECIPIENT?.trim();
  if (env.NODE_ENV !== "development" || env.VERCEL || sender.toLowerCase() !== "onboarding@resend.dev" || !recipient) return sender;
  if (recipient.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(recipient)) throw new Error("Invalid Resend test recipient.");
  return recipient;
}
