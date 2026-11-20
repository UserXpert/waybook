import { test } from "node:test";
import assert from "node:assert/strict";
import { emailQueueWarning } from "./email-queue-health.ts";

test("queue health explains disabled delivery, missing provider and delayed messages", () => {
  const ready = { enabled: true, keyConfigured: true, verified: true, overdue: 0, schedulerRecent: true };
  assert.equal(emailQueueWarning(ready), null);
  assert.match(emailQueueWarning({ ...ready, enabled: false })!, /sender is verified.*automatic booking emails are off/i);
  assert.match(emailQueueWarning({ ...ready, enabled: false, verified: false, testAvailable: true })!, /QA test email.*automatic delivery is currently off/i);
  assert.match(emailQueueWarning({ ...ready, enabled: false, verified: false, testAvailable: false })!, /connect and verify/i);
  assert.match(emailQueueWarning({ ...ready, keyConfigured: false })!, /setup is unavailable/i);
  assert.match(emailQueueWarning({ ...ready, verified: false })!, /verify/);
  assert.match(emailQueueWarning({ ...ready, overdue: 2 })!, /2 emails/);
  assert.match(emailQueueWarning({ ...ready, schedulerRecent: false })!, /scheduler has not run/);
});
