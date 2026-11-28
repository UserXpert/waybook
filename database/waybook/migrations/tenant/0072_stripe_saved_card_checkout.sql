ALTER TABLE stripe_sandbox_checkout_attempts
  ADD COLUMN stripe_customer_id TEXT
  CHECK (stripe_customer_id IS NULL OR stripe_customer_id ~ '^cus_[A-Za-z0-9]+$');
