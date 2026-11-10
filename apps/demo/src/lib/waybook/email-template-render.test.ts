import assert from "node:assert/strict";
import test from "node:test";
import { emailTemplateError, renderBookingEmail, unknownEmailPlaceholders } from "./email-template-render.ts";

const values = { customer_name: "Alex {{service_name}}", business_name: "Nordic", service_name: "Massage", appointment_date: "15 March, 10:00", booking_number: "AB123" };

test("template validation rejects unsupported or malformed placeholders and subject headers", () => {
  assert.equal(emailTemplateError("Hello {{customer_name}}", "See you at {{appointment_date}}"), null);
  assert.match(emailTemplateError("Hello", "{{unknown}}")!, /Unsupported/);
  assert.match(emailTemplateError("Hello", "{{customer_name")!, /matching braces/);
  assert.match(emailTemplateError("Hello\nInjected", "Message")!, /single-line/);
});

test("booking email renders only approved placeholders once", () => {
  assert.deepEqual(renderBookingEmail("Booking at {{ business_name }}", "Hello {{customer_name}}: {{service_name}}", values), { subject: "Booking at Nordic", text: "Hello Alex {{service_name}}: Massage" });
  assert.deepEqual(unknownEmailPlaceholders("{{unknown}} {{unknown}} {{service_name}}"), ["unknown"]);
});

test("booking email refuses unknown, missing and unsafe header data", () => {
  assert.throws(() => renderBookingEmail("Hello", "{{unknown}}", values), /unsupported/);
  assert.throws(() => renderBookingEmail("Hello", "{{booking_number}}", { ...values, booking_number: "" }), /missing/);
  assert.throws(() => renderBookingEmail("Hi {{customer_name}}", "Hello", { ...values, customer_name: "Name\nInjected" }), /invalid/);
});
