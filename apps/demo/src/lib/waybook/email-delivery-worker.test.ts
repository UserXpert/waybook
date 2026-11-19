import assert from "node:assert/strict";
import test from "node:test";
import { deliverOneEmail } from "./email-delivery-worker.ts";
import { resendOnboardingTestSender } from "./resend-onboarding-test.ts";

test("worker refuses queued delivery from the onboarding sender before claiming an email", async () => {
  let queries = 0;
  const db = { unsafe: async () => { queries++; return [{ id: "connection", sender: resendOnboardingTestSender, createdAt: new Date() }]; } };
  const result = await deliverOneEmail(db as never, "tenant", () => undefined, async () => { throw Error("must not send"); });
  assert.equal(result, "not_configured");
  assert.equal(queries, 1);
});
