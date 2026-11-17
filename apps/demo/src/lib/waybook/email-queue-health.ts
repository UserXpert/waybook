export function emailQueueWarning(input: { enabled: boolean; keyConfigured: boolean; verified: boolean; overdue: number; schedulerRecent: boolean }): string | null {
  if (!input.enabled || !input.keyConfigured) return "Email delivery is not active. Contact Waybook support before relying on booking emails.";
  if (!input.verified) return "Connect and verify your email provider before sending booking emails.";
  if (!input.schedulerRecent) return "The email delivery scheduler has not run recently. Contact Waybook support.";
  if (input.overdue > 0) return `${input.overdue} ${input.overdue === 1 ? "email has" : "emails have"} been waiting longer than expected. Check delivery status or contact Waybook support.`;
  return null;
}
