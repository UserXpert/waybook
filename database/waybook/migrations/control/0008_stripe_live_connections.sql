CREATE TABLE waybook_stripe_live_connections (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE RESTRICT,
  country TEXT NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  account_id TEXT UNIQUE CHECK (account_id ~ '^acct_[A-Za-z0-9]+$'),
  creation_key UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  creation_started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
