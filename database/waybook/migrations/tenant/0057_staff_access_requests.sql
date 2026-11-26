CREATE TABLE staff_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenant_settings (tenant_id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(btrim(email))),
  phone TEXT NOT NULL CHECK (length(phone) BETWEEN 3 AND 40),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  invited_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX staff_access_requests_pending_email
  ON staff_access_requests (tenant_id, email) WHERE invited_at IS NULL;
CREATE INDEX staff_access_requests_recent
  ON staff_access_requests (tenant_id, created_at DESC);
