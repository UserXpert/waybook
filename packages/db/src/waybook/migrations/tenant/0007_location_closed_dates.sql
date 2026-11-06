CREATE TABLE IF NOT EXISTS location_closed_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (location_id, local_date)
);

CREATE INDEX IF NOT EXISTS location_closed_dates_tenant_date_idx
  ON location_closed_dates (tenant_id, local_date);
