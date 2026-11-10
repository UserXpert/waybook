import assert from "node:assert/strict";
import test from "node:test";
import { previewEmailTemplate } from "./email-template-preview.ts";

test("email preview substitutes example values without interpreting their contents", () => {
  const example = { customer_name: "Alex {{service_name}}", business_name: "Studio", service_name: "Massage", appointment_date: "15 March", booking_number: "AB123" };
  assert.equal(previewEmailTemplate("Hello {{customer_name}} at {{ business_name }}", example), "Hello Alex {{service_name}} at Studio");
  assert.equal(previewEmailTemplate("{{unknown}} {{booking_number}}", example), "{{unknown}} AB123");
});
