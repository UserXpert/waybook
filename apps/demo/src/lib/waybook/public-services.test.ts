import assert from "node:assert/strict";
import test from "node:test";
import { servicesAtLocation } from "./public-services.ts";

test("public service choices follow the selected location", () => {
  const services = [
    { id: "one", locationIds: ["north"] },
    { id: "both", locationIds: ["north", "south"] },
    { id: "unassigned", locationIds: [] },
  ];
  assert.deepEqual(servicesAtLocation(services, "north").map((service) => service.id), ["one", "both"]);
  assert.deepEqual(servicesAtLocation(services, "south").map((service) => service.id), ["both"]);
  assert.deepEqual(servicesAtLocation(services, "unknown"), []);
  assert.deepEqual(servicesAtLocation(services, ""), []);
});
