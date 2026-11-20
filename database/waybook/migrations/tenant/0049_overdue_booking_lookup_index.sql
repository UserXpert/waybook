-- The request and scheduled sweeps look for the oldest ended, confirmed
-- booking. Keep completed history out of that lookup as a tenant grows.
CREATE INDEX IF NOT EXISTS bookings_overdue_confirmed_idx
  ON bookings (tenant_id, ends_at, id) INCLUDE (booking_block_id)
  WHERE status = 'confirmed';
