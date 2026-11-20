-- Managers check for ended arrivals on every dashboard page. Keep unrelated
-- booking history out of both that lookup and the review list.
CREATE INDEX IF NOT EXISTS bookings_arrived_review_idx
  ON bookings (tenant_id, ends_at DESC)
  WHERE status = 'arrived';
