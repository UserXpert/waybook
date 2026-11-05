import assert from "node:assert/strict";
import test from "node:test";
import { tenantDashboardHref } from "./tenant-dashboard-link.ts";

test("uses the tenant localhost host and Control port during local development", () => {
  assert.equal(tenantDashboardHref("localhost:3333", "nordic.localhost"), "http://nordic.localhost:3333/app");
});

test("uses the registered tenant host in hosted environments", () => {
  assert.equal(tenantDashboardHref("waybook-booking.vercel.app", "nordic.localhost", "nordic-waybook-booking.vercel.app"), "https://nordic-waybook-booking.vercel.app/app");
});

test("falls back to the deployed Control origin until a tenant host is registered", () => {
  assert.equal(tenantDashboardHref("waybook-booking.vercel.app", "nordic.localhost"), "https://waybook-booking.vercel.app/app");
});
