-- Delivery stays disabled until a worker and tenant-owned provider are configured.
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_claim_token UUID;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_claim_until TIMESTAMPTZ;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_first_attempt_at TIMESTAMPTZ;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_next_attempt_at TIMESTAMPTZ;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_snapshot JSONB;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_provider_id TEXT;
ALTER TABLE email_outbox ADD COLUMN IF NOT EXISTS delivery_result TEXT;

CREATE INDEX IF NOT EXISTS email_outbox_delivery_queue_idx
  ON email_outbox (tenant_id, delivery_next_attempt_at, created_at, id)
  WHERE status = 'queued';
