import assert from "node:assert/strict";
import postgres from "postgres";
import { replaceEmailConnection } from "../apps/demo/src/lib/waybook/email-provider-connection";
import { deliverOneEmail } from "../apps/demo/src/lib/waybook/email-delivery-worker";
import type { sendWithResend } from "../apps/demo/src/lib/waybook/resend-delivery";

// This verifier works with the disposable lifecycle fixture, never a real tenant.
const url = process.env.WAYBOOK_EMAIL_INTEGRATION_TEST_DATABASE_URL;
if (!url || !/^waybook_lifecycle_[0-9]+$/.test(new URL(url).pathname.slice(1))) throw new Error("Use a disposable waybook_lifecycle_* database.");
if (!["seed", "verify"].includes(process.argv[2] ?? "")) throw new Error("Choose seed or verify.");
const db = postgres(url, { max: 3, ssl: false, onnotice: () => {} });
const tenant = "459cd62f-caa8-406d-9b15-58c69feb95ec";
const key = { id: "fixture", key: Buffer.alloc(32, 7) };
async function main() { try {
  if (process.argv[2] === "seed") {
    await replaceEmailConnection(db, tenant, "studio@example.invalid", "fake-resend-key", key);
    await db`UPDATE email_provider_connections SET verified_at=now() WHERE tenant_id=${tenant} AND revoked_at IS NULL`;
  } else {
    for (const [booking, type] of [["60000000-0000-4000-8000-000000000001", "confirmation"], ["60000000-0000-4000-8000-000000000002", "cancellation"]]) {
      const [entry] = await db<{ id: string }[]>`SELECT id FROM email_outbox WHERE tenant_id=${tenant} AND booking_id=${booking} AND message_type=${type} ORDER BY created_at DESC LIMIT 1`;
      assert.ok(entry, `${type} must be queued by the API`);
      let calls = 0;
      const fake: typeof sendWithResend = async (input) => {
        calls++;
        assert.equal(input.apiKey, "fake-resend-key");
        assert.equal(input.message.to, "customer@example.invalid");
        return { kind: "accepted", providerId: "fake-provider-id" };
      };
      assert.equal(await deliverOneEmail(db, tenant, (id) => id === key.id ? key.key : undefined, fake, entry.id), "processed");
      assert.equal(calls, 1);
      const [state] = await db<{ status: string; result: string }[]>`SELECT status,delivery_result AS result FROM email_outbox WHERE id=${entry.id}`;
      assert.deepEqual(state, { status: "sent", result: "accepted" });
    }
    console.log("Reschedule and cancellation events reached the fake provider and persisted accepted status.");
  }
} finally {
  await db.end();
} }
main().catch((error) => { console.error(error); process.exitCode = 1; });
