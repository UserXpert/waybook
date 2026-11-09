-- Shared across application instances for public booking-management requests.
-- Keys contain a hash of a random booking reference, never an email address.
CREATE TABLE IF NOT EXISTS booking_management_rate_limits (
  tenant_id UUID NOT NULL,
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (tenant_id, bucket_key)
);
CREATE INDEX IF NOT EXISTS booking_management_rate_limits_expiry_idx
  ON booking_management_rate_limits (window_start);
