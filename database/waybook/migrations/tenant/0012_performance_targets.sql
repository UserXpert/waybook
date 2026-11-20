CREATE TABLE IF NOT EXISTS performance_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('staff', 'service')),
  scope_id UUID NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('bookings', 'booked_value_cents')),
  period_start DATE NOT NULL,
  target_value INTEGER NOT NULL CHECK (target_value > 0),
  created_by_identity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope_type, scope_id, metric, period_start)
);

CREATE INDEX IF NOT EXISTS performance_targets_tenant_period_idx
  ON performance_targets(tenant_id, period_start, scope_type);
