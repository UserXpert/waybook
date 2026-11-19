import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { BookingConflictError, withSerializableRetry } from "../apps/demo/src/lib/waybook/transaction-conflicts.ts";

const raw = process.env.WAYBOOK_CONTROL_DATABASE_URL;
if (!raw) throw new Error("Set WAYBOOK_CONTROL_DATABASE_URL to the disposable E2E Control database.");
const url = new URL(raw);
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || url.pathname !== "/waybook_e2e_control") {
  throw new Error("Transaction verification requires the local waybook_e2e_control database.");
}
const db = postgres(raw, { max: 4, ssl: false });
const suffix = randomBytes(6).toString("hex");
const counter = `waybook_retry_${suffix}`;
const exclusion = `waybook_exclusion_${suffix}`;
let arrived = 0;
let release!: () => void;
const barrier = new Promise<void>((resolve) => { release = resolve; });
let attempts = 0;
try {
  await db.unsafe(`CREATE TABLE ${counter} (id integer PRIMARY KEY, value integer NOT NULL)`);
  await db.unsafe(`INSERT INTO ${counter} VALUES (1, 0)`);
  const update = () => withSerializableRetry(() => db.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
    const [row] = await tx.unsafe<{ value: number }[]>(`SELECT value FROM ${counter} WHERE id = 1`);
    attempts++;
    if (arrived < 2) { arrived++; if (arrived === 2) release(); await barrier; }
    await tx.unsafe(`UPDATE ${counter} SET value = $1 WHERE id = 1`, [row.value + 1]);
  }), { baseDelayMs: 1 });
  await Promise.all([update(), update()]);
  const [row] = await db.unsafe<{ value: number }[]>(`SELECT value FROM ${counter} WHERE id = 1`);
  assert.equal(row.value, 2, "both concurrent updates must commit");
  assert.ok(attempts >= 3, "a serialization conflict must be retried");

  await db.unsafe(`CREATE TABLE ${exclusion} (slot int4range NOT NULL, EXCLUDE USING gist (slot WITH &&))`);
  await db.unsafe(`INSERT INTO ${exclusion} VALUES (int4range(10,20))`);
  let calls = 0;
  await assert.rejects(withSerializableRetry(async () => {
    calls++;
    await db.unsafe(`INSERT INTO ${exclusion} VALUES (int4range(15,25))`);
  }), BookingConflictError);
  assert.equal(calls, 1, "an exclusion conflict must not be retried");
  console.log("Concurrent transactions retry safely; overlapping slots produce one booking conflict.");
} finally {
  await db.unsafe(`DROP TABLE IF EXISTS ${counter}`);
  await db.unsafe(`DROP TABLE IF EXISTS ${exclusion}`);
  await db.end();
}
