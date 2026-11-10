import { test } from "node:test";
import assert from "node:assert/strict";
import { drainEmailQueues } from "./email-sweep.ts";

test("sweeps take turns and stop when queues empty or hit their limit", async () => {
  const calls: string[] = [], heartbeats: string[] = [];
  const counts: Record<string, number> = { a: 0, b: 0 };
  const result = await drainEmailQueues({ tenants: ["a", "b"], deadline: 100, now: () => 0, perTenantLimit: 3,
    process: async (id) => { calls.push(id); counts[id]++; return id === "b" && counts[id] > 1 ? "empty" : "processed"; },
    completed: async (id) => { heartbeats.push(id); }, failed: () => { throw new Error("unexpected failure"); },
  });
  assert.deepEqual(calls, ["a", "b", "a", "b", "a"]);
  assert.deepEqual(heartbeats, ["a", "b"]);
  assert.deepEqual(result, { processed: 4, failures: 0, incomplete: false });
});

test("a tenant failure does not block others and deadlines are reported", async () => {
  const failed: string[] = [];
  let clock = 0;
  const result = await drainEmailQueues({ tenants: ["a", "b", "c"], deadline: 2, now: () => clock,
    process: async (id) => { clock++; if (id === "a") throw new Error("fixture"); return "processed"; },
    completed: async () => {}, failed: (id) => { failed.push(id); },
  });
  assert.deepEqual(failed, ["a"]);
  assert.deepEqual(result, { processed: 1, failures: 1, incomplete: true });
});
