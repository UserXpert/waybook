CREATE TABLE IF NOT EXISTS email_reminder_settings (
  tenant_id UUID PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  lead_hours INTEGER NOT NULL DEFAULT 24 CHECK (lead_hours BETWEEN 1 AND 168),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE email_outbox DROP CONSTRAINT IF EXISTS email_outbox_message_type_check;
ALTER TABLE email_outbox ADD CONSTRAINT email_outbox_message_type_check CHECK (message_type IN ('confirmation','cancellation','reminder'));
ALTER TABLE email_templates DROP CONSTRAINT IF EXISTS email_templates_template_key_check;
ALTER TABLE email_templates ADD CONSTRAINT email_templates_template_key_check CHECK (template_key IN ('booking','confirmation','cancellation','sale','reminder'));
CREATE UNIQUE INDEX IF NOT EXISTS email_outbox_reminder_occurrence_idx
  ON email_outbox (tenant_id, booking_id, (payload->>'startsAt')) WHERE message_type = 'reminder' AND NOT (payload ? 'retryOf');
