import assert from "node:assert/strict";
import { test } from "node:test";
import { emailVerificationRecipient } from "./email-test-recipient";

test("only allows a configured inbox for the shared sender in local development", () => {
  const env = { NODE_ENV: "development", WAYBOOK_RESEND_TEST_RECIPIENT: "test@example.com" };
  assert.equal(emailVerificationRecipient("onboarding@resend.dev", env), "test@example.com");
  assert.equal(emailVerificationRecipient("sender@example.com", env), "sender@example.com");
  assert.equal(emailVerificationRecipient("onboarding@resend.dev", { ...env, NODE_ENV: "production" }), "onboarding@resend.dev");
  assert.equal(emailVerificationRecipient("onboarding@resend.dev", { ...env, VERCEL: "1" }), "onboarding@resend.dev");
  assert.throws(() => emailVerificationRecipient("onboarding@resend.dev", { ...env, WAYBOOK_RESEND_TEST_RECIPIENT: "bad\naddress" }), /Invalid/);
});
