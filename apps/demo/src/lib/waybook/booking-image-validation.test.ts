import { strict as assert } from "node:assert";
import { test } from "node:test";
import { bookingImageError } from "./booking-image-validation";

test("booking images reject oversized or unsupported files before submission", () => {
  assert.equal(bookingImageError({ type: "image/png", size: 250_000 }), "");
  assert.match(bookingImageError({ type: "image/png", size: 250_001 }), /too large/i);
  assert.match(bookingImageError({ type: "image/png", size: 1_228_800 }), /too large/i);
  assert.match(bookingImageError({ type: "image/svg+xml", size: 100 }), /JPG, PNG or WebP/);
});
