-- A room may either be a shared label/capability or a physically exclusive
-- unit. Keep resource assignment on bookings in both cases, but let the
-- availability layer decide whether simultaneous use is allowed.
ALTER TABLE resources
  ADD COLUMN IF NOT EXISTS is_mutually_exclusive BOOLEAN NOT NULL DEFAULT TRUE;

-- The former unconditional database exclusion made every resource exclusive.
-- Exclusive resources remain protected by the application transaction; shared
-- resources intentionally permit overlapping booking blocks.
ALTER TABLE booking_blocks
  DROP CONSTRAINT IF EXISTS booking_blocks_resource_no_overlap;
