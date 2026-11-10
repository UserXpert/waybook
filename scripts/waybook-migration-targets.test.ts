import assert from "node:assert/strict";
import { test } from "node:test";
import { migrationTargets } from "./waybook-migration-targets.ts";

const configured = {
  WAYBOOK_CONTROL_DATABASE_URL: "postgresql://user:secret@localhost/control",
  WAYBOOK_NORDIC_STUDIO_DATABASE_URL: "postgresql://user:secret@localhost/nordic",
  WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL: "postgresql://user:secret@localhost/physio",
};

test("validates all configured migration targets before use", () => {
  assert.deepEqual(migrationTargets(configured, false).map((target) => target.kind), ["control", "tenant", "tenant"]);
  assert.throws(() => migrationTargets({ ...configured, WAYBOOK_COPENHAGEN_PHYSIO_DATABASE_URL: "" }, false), /Missing database URLs/);
  assert.throws(() => migrationTargets({ ...configured, WAYBOOK_NORDIC_STUDIO_DATABASE_URL: "not a URL" }, false), /Invalid database URL/);
  assert.throws(() => migrationTargets({ ...configured, WAYBOOK_NORDIC_STUDIO_DATABASE_URL: "postgresql://another@localhost:5432/control" }, false), /Duplicate database target/);
});

test("local defaults are explicit and cannot be mixed with configured URLs", () => {
  assert.equal(migrationTargets({}, true).length, 3);
  assert.throws(() => migrationTargets(configured, true), /cannot be combined/);
  assert.throws(() => migrationTargets({}, false), /Missing database URLs/);
});
