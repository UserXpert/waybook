import assert from "node:assert/strict";
import postgres from "postgres";

const baseUrl = process.env.WAYBOOK_TEST_BASE_URL ?? "http://nordic.localhost:3333";
const databaseUrl = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL ?? "postgresql://waybook@127.0.0.1:5440/waybook_nordic_studio";
const db = postgres(databaseUrl, { max: 1, ssl: false });

type Slot = { startTime: string; endTime: string };
type Availability = { teamMemberId: string; slots: Slot[] };
type Hold = { holdId: string; teamMember: { id: string; name: string } };

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { response, body };
}

async function cleanup(holdIds: string[]) {
  for (const holdId of holdIds) {
    const blocks = await db<{ bookingBlockId: string }[]>`SELECT booking_block_id AS "bookingBlockId" FROM booking_holds WHERE id = ${holdId}`;
    await db`DELETE FROM booking_holds WHERE id = ${holdId}`;
    for (const block of blocks) {
      await db`DELETE FROM booking_blocks WHERE id = ${block.bookingBlockId}`;
    }
  }
}

async function main() {
  const holdIds: string[] = [];
  try {
    const [service] = await db<{ id: string }[]>`SELECT id FROM services WHERE slug = 'studio-session' AND is_active = true LIMIT 1`;
    assert.ok(service, "Studio session service is not available");
    const now = new Date();
    const end = new Date(now.getTime() + 21 * 24 * 60 * 60_000);
    const availability = await request(`/api/public/availability?service=studio-session&start=${encodeURIComponent(now.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
    assert.equal(availability.response.status, 200, `availability failed: ${availability.body.error ?? "unknown error"}`);
    const providers = availability.body.availability as Availability[];
    const shared = providers[0]?.slots.find((slot) => providers.filter((provider) => provider.slots.some((candidate) => candidate.startTime === slot.startTime && candidate.endTime === slot.endTime)).length >= 2);
    assert.ok(shared, "expected a shared Studio session slot for two eligible employees");

    const reserve = async () => {
      const result = await request("/api/public/holds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ serviceId: service.id, startsAt: shared.startTime, endsAt: shared.endTime }),
      });
      assert.equal(result.response.status, 201, `hold failed: ${result.body.error ?? "unknown error"}`);
      const hold = result.body as Hold;
      holdIds.push(hold.holdId);
      return hold;
    };

    const eligibleCount = providers.filter((provider) => provider.slots.some((slot) => slot.startTime === shared.startTime && slot.endTime === shared.endTime)).length;
    const heldProviders: Hold[] = [];
    for (let index = 0; index < eligibleCount; index += 1) {
      const hold = await reserve();
      assert.ok(!heldProviders.some((prior) => prior.teamMember.id === hold.teamMember.id), "a hold reused an already-reserved staff member");
      heldProviders.push(hold);
      const afterHold = await request(`/api/public/availability?service=studio-session&start=${encodeURIComponent(shared.startTime)}&end=${encodeURIComponent(shared.endTime)}`);
      assert.equal(afterHold.response.status, 200);
      const stillAvailable = (afterHold.body.availability as Availability[]).some((provider) => provider.slots.some((slot) => slot.startTime === shared.startTime && slot.endTime === shared.endTime));
      assert.equal(stillAvailable, index < eligibleCount - 1, "staff capacity did not change after the hold as expected");
    }

    console.log(`Pooled availability passed: ${eligibleCount} eligible staff were held, then the shared time disappeared.`);
  } finally {
    await cleanup(holdIds);
    await db.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
