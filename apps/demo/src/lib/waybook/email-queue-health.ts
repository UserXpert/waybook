export function emailQueueWarning(input: { enabled: boolean; keyConfigured: boolean; verified: boolean; overdue: number; schedulerRecent: boolean; testAvailable?: boolean }): string | null {
  if (!input.keyConfigured) return "Email provider setup is unavailable. Contact Waybook support.";
  if (!input.enabled && !input.verified && input.testAvailable) return "A QA test email is available. To send booking emails to clients, connect and verify a business sender; automatic delivery is currently off.";
  if (!input.enabled && !input.verified) return "Booking emails are off. Connect and verify a business sender to prepare for delivery.";
  if (!input.enabled) return "Your sender is verified, but automatic booking emails are off. Contact Waybook support to enable delivery.";
  if (!input.verified) return "Connect and verify your email provider before sending booking emails.";
  if (!input.schedulerRecent) return "The email delivery scheduler has not run recently. Contact Waybook support.";
  if (input.overdue > 0) return `${input.overdue} ${input.overdue === 1 ? "email has" : "emails have"} been waiting longer than expected. Check delivery status or contact Waybook support.`;
  return null;
}
