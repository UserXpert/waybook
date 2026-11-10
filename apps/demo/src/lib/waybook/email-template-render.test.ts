import assert from "node:assert/strict";
import test from "node:test";
import { renderBookingEmail, unknownEmailPlaceholders } from "./email-template-render.ts";

const values = { customer_name: "Alex {{service_name}}", business_name: "Nordic", service_name: "Massage", appointment_date: "15 March, 10:00", booking_number: "AB123" };

test("booking email renders only approved placeholders once", () => {
  assert.deepEqual(renderBookingEmail("Booking at {{ business_name }}", "Hello {{customer_name}}: {{service_name}}", values), { subject: "Booking at Nordic", text: "Hello Alex {{service_name}}: Massage" });
  assert.deepEqual(unknownEmailPlaceholders("{{unknown}} {{unknown}} {{service_name}}"), ["unknown"]);
});

test("booking email refuses unknown, missing and unsafe header data", () => {
  assert.throws(() => renderBookingEmail("Hello", "{{unknown}}", values), /unsupported/);
  assert.throws(() => renderBookingEmail("Hello", "{{booking_number}}", { ...values, booking_number: "" }), /missing/);
  assert.throws(() => renderBookingEmail("Hi {{customer_name}}", "Hello", { ...values, customer_name: "Name\nInjected" }), /invalid/);
});
