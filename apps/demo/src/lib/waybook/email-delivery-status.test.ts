import { test } from "node:test";
import assert from "node:assert/strict";
import { emailDeliveryDescription } from "./email-delivery-status.ts";

test("mailbox distinguishes acceptance, uncertain delivery, and rejected emails", () => {
  assert.match(emailDeliveryDescription("sent", "accepted"), /Inbox delivery is not confirmed/);
  assert.match(emailDeliveryDescription("failed", "review"), /avoid a duplicate/);
  assert.match(emailDeliveryDescription("failed", "rejected"), /rejected/);
  assert.match(emailDeliveryDescription("queued", "retry"), /retried/);
  assert.match(emailDeliveryDescription("failed", "superseded"), /skipped/);
});
