import assert from "node:assert/strict";
import test from "node:test";
import { configuredResendOnboardingTest, isResendOnboardingTestSender, resendOnboardingTestSender, sendResendOnboardingTest } from "./resend-onboarding-test.ts";
import { renderBookingEmail } from "./email-template-render.ts";

test("controlled onboarding test is disabled unless its exact gate, recipient, and API key are configured", () => {
  assert.equal(configuredResendOnboardingTest({}), null);
  assert.equal(configuredResendOnboardingTest({ WAYBOOK_RESEND_ONBOARDING_TEST_ENABLED: "false", WAYBOOK_RESEND_ONBOARDING_TEST_API_KEY: "test-key", WAYBOOK_RESEND_ONBOARDING_TEST_RECIPIENT: "qa@example.test" }), null);
  assert.equal(configuredResendOnboardingTest({ WAYBOOK_RESEND_ONBOARDING_TEST_ENABLED: "true", WAYBOOK_RESEND_ONBOARDING_TEST_API_KEY: "test-key", WAYBOOK_RESEND_ONBOARDING_TEST_RECIPIENT: "not-an-email" }), null);
  assert.deepEqual(configuredResendOnboardingTest({ WAYBOOK_RESEND_ONBOARDING_TEST_ENABLED: "true", WAYBOOK_RESEND_ONBOARDING_TEST_API_KEY: "test-key", WAYBOOK_RESEND_ONBOARDING_TEST_RECIPIENT: "qa@example.test" }), { apiKey: "test-key", recipient: "qa@example.test" });
});

test("controlled onboarding test sends the rendered confirmation format only to the configured recipient", async () => {
  const calls: Array<{ apiKey: string; idempotencyKey: string; message: { from: string; to: string; subject: string; text: string } }> = [];
  const send = async (input: Parameters<typeof sendResendOnboardingTest>[0] extends never ? never : Parameters<NonNullable<Parameters<typeof sendResendOnboardingTest>[0]["send"]>>[0]) => {
    calls.push(input);
    return { kind: "accepted" as const, providerId: "provider-id" };
  };
  const message = renderBookingEmail("Confirmed: {{booking_number}}", "Hello {{customer_name}} — {{service_name}} at {{appointment_date}} for {{business_name}}.", { customer_name: "QA recipient", business_name: "Example studio", service_name: "Example service", appointment_date: "Friday, 1 January 2038 at 09:00", booking_number: "QA-TEST-0001" });
  const result = await sendResendOnboardingTest({ tenantId: "tenant-a", config: { apiKey: "test-key", recipient: "qa@example.test" }, message, send });
  assert.deepEqual(result, { kind: "accepted", providerId: "provider-id" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].apiKey, "test-key");
  assert.equal(calls[0].idempotencyKey, "waybook-onboarding-test/tenant-a");
  assert.deepEqual(calls[0].message, { from: resendOnboardingTestSender, to: "qa@example.test", subject: "Confirmed: QA-TEST-0001", text: "Hello QA recipient — Example service at Friday, 1 January 2038 at 09:00 for Example studio." });
});

test("the onboarding sender is recognized case-insensitively for worker refusal", () => {
  assert.equal(isResendOnboardingTestSender("ONBOARDING@RESEND.DEV"), true);
  assert.equal(isResendOnboardingTestSender("sender@example.test"), false);
});
