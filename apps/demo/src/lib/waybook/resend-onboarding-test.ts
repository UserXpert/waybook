import { sendWithResend, type ResendMessage, type ResendResult } from "./resend-delivery";

export const resendOnboardingTestSender = "onboarding@resend.dev";

type Environment = Record<string, string | undefined>;
export type ResendOnboardingTestConfig = { apiKey: string; recipient: string };

const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function isResendOnboardingTestSender(value: string) {
  return value.trim().toLowerCase() === resendOnboardingTestSender;
}

/** The recipient is deployment configuration, never a browser-controlled value. */
export function configuredResendOnboardingTest(environment: Environment = process.env): ResendOnboardingTestConfig | null {
  if (environment.WAYBOOK_RESEND_ONBOARDING_TEST_ENABLED !== "true") return null;
  const apiKey = environment.WAYBOOK_RESEND_ONBOARDING_TEST_API_KEY?.trim() ?? "";
  const recipient = environment.WAYBOOK_RESEND_ONBOARDING_TEST_RECIPIENT?.trim() ?? "";
  if (!apiKey || /[\r\n]/.test(apiKey) || Buffer.byteLength(apiKey, "utf8") > 4096 || !emailPattern.test(recipient) || recipient.length > 254) return null;
  return { apiKey, recipient };
}

/** Sends a rendered synthetic confirmation only to the configured QA mailbox. */
export async function sendResendOnboardingTest(input: {
  tenantId: string;
  config: ResendOnboardingTestConfig;
  message: Pick<ResendMessage, "subject" | "text">;
  send?: typeof sendWithResend;
}): Promise<ResendResult> {
  return (input.send ?? sendWithResend)({
    apiKey: input.config.apiKey,
    idempotencyKey: `waybook-onboarding-test/${input.tenantId}`,
    firstAttemptAt: new Date(),
    message: {
      from: resendOnboardingTestSender,
      to: input.config.recipient,
      subject: input.message.subject,
      text: input.message.text,
    },
  });
}
