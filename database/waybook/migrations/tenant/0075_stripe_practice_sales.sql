ALTER TABLE commerce_sales
  ADD COLUMN is_stripe_practice BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN stripe_practice_session_id TEXT UNIQUE,
  ADD COLUMN stripe_practice_cleared_at TIMESTAMPTZ,
  ADD CONSTRAINT commerce_stripe_practice_scope CHECK (
    (NOT is_stripe_practice AND stripe_practice_session_id IS NULL AND stripe_practice_cleared_at IS NULL)
    OR (is_stripe_practice AND booking_id IS NULL AND customer_id IS NULL AND location_id IS NULL
      AND currency = 'DKK' AND (stripe_practice_session_id IS NULL OR stripe_practice_session_id ~ '^cs_test_[A-Za-z0-9]+$'))
  );

CREATE INDEX commerce_stripe_practice_active_idx ON commerce_sales (tenant_id, created_at DESC)
  WHERE is_stripe_practice AND stripe_practice_cleared_at IS NULL;
