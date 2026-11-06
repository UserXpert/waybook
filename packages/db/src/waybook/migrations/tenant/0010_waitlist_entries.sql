CREATE TABLE IF NOT EXISTS waitlist_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  preferred_team_member_id UUID REFERENCES team_members(id) ON DELETE SET NULL,
  preferred_local_date DATE,
  preferred_start_time TIME,
  preferred_end_time TIME,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'booked', 'cancelled')),
  notes TEXT,
  created_by_identity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (preferred_start_time IS NULL AND preferred_end_time IS NULL)
    OR (preferred_start_time IS NOT NULL AND preferred_end_time IS NOT NULL AND preferred_end_time > preferred_start_time)
  )
);

CREATE INDEX IF NOT EXISTS waitlist_entries_tenant_status_created_idx
  ON waitlist_entries(tenant_id, status, created_at ASC);
CREATE INDEX IF NOT EXISTS waitlist_entries_customer_idx
  ON waitlist_entries(tenant_id, customer_id, created_at DESC);
