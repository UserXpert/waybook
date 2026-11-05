import assert from "node:assert/strict";
import test from "node:test";
import { tenantDashboardHref } from "./tenant-dashboard-link.ts";
import { routeSlugFromHostname, tenantPath } from "./tenant-routes.ts";

test("uses a same-origin tenant path during local development", () => {
  assert.equal(tenantDashboardHref("localhost:3333", "nordic"), "http://localhost:3333/nordic/app");
});

test("uses a same-origin tenant path when hosted", () => {
  assert.equal(tenantDashboardHref("waybook-booking.vercel.app", "copenhagen"), "https://waybook-booking.vercel.app/copenhagen/app");
});

test("derives initial route slugs from registered local tenant domains", () => {
  assert.equal(routeSlugFromHostname("copenhagen.localhost", "copenhagen-physio"), "copenhagen");
  assert.equal(tenantPath("nordic", "/book"), "/nordic/book");
});
