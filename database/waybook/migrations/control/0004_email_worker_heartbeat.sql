CREATE TABLE IF NOT EXISTS email_worker_heartbeats (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  last_success_at TIMESTAMPTZ NOT NULL
);
