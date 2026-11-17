import assert from "node:assert/strict";
import test from "node:test";
import { canEditStaffPhoto } from "./staff-photo-permissions.ts";

test("only managers and the owning staff member can edit a staff photo", () => {
  for (const role of ["owner", "manager"]) assert.equal(canEditStaffPhoto(role, null, "member-a"), true);
  assert.equal(canEditStaffPhoto("staff", "member-a", "member-a"), true);
  assert.equal(canEditStaffPhoto("staff", "member-a", "member-b"), false);
  assert.equal(canEditStaffPhoto("staff", null, "member-a"), false);
  assert.equal(canEditStaffPhoto("read-only", "member-a", "member-a"), false);
  assert.equal(canEditStaffPhoto("unknown", "member-a", "member-a"), false);
  assert.equal(canEditStaffPhoto("owner", null, ""), false);
});
