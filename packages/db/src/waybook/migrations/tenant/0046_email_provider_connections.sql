CREATE TABLE IF NOT EXISTS email_provider_connections (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'resend'),
  sender_email TEXT NOT NULL,
  encrypted_secret JSONB NOT NULL CHECK (jsonb_typeof(encrypted_secret) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  verification_attempt_id UUID,
  verification_started_at TIMESTAMPTZ,
  verification_claim_token UUID,
  verification_claim_until TIMESTAMPTZ,
  verification_accepted_at TIMESTAMPTZ,
  verification_provider_id TEXT,
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS email_provider_one_active_per_tenant
  ON email_provider_connections (tenant_id) WHERE revoked_at IS NULL;
