CREATE TABLE IF NOT EXISTS email_provider_connections (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'resend'),
  sender_email TEXT NOT NULL,
  encrypted_secret JSONB NOT NULL CHECK (jsonb_typeof(encrypted_secret) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS email_provider_one_active_per_tenant
  ON email_provider_connections (tenant_id) WHERE revoked_at IS NULL;
