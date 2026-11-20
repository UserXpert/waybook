ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booked_price_cents INTEGER;

-- Existing bookings predate price snapshots. Their initial historical value is
-- backfilled from the current matching service catalogue price once; all future
-- bookings write their own immutable value at confirmation.
UPDATE bookings b
SET booked_price_cents = s.price_cents
FROM services s
WHERE s.id = b.service_id
  AND s.tenant_id = b.tenant_id
  AND b.booked_price_cents IS NULL;

ALTER TABLE bookings ALTER COLUMN booked_price_cents SET NOT NULL;
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_booked_price_cents_nonnegative;
ALTER TABLE bookings ADD CONSTRAINT bookings_booked_price_cents_nonnegative CHECK (booked_price_cents >= 0);
