import assert from "node:assert/strict";
import test from "node:test";
import { tenantDashboardHref } from "./tenant-dashboard-link.ts";

test("uses the tenant localhost host and Control port during local development", () => {
  assert.equal(tenantDashboardHref("localhost:3333", "nordic.localhost"), "http://nordic.localhost:3333/app");
});

test("uses the deployed Control origin in hosted environments", () => {
  assert.equal(tenantDashboardHref("waybook-booking.vercel.app", "nordic.localhost"), "https://waybook-booking.vercel.app/app");
});
