-- A booking block reserves the effective range including service buffers.
-- Retain the customer-visible interval on the hold so confirmation can create
-- the appointment without reconstructing it from a mutable service record.
ALTER TABLE booking_holds
  ADD COLUMN IF NOT EXISTS scheduled_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduled_ends_at TIMESTAMPTZ;

ALTER TABLE booking_holds
  DROP CONSTRAINT IF EXISTS booking_holds_scheduled_interval;
ALTER TABLE booking_holds
  ADD CONSTRAINT booking_holds_scheduled_interval
  CHECK (
    (scheduled_starts_at IS NULL AND scheduled_ends_at IS NULL)
    OR scheduled_ends_at > scheduled_starts_at
  );
