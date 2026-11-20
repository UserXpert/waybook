CREATE TABLE IF NOT EXISTS feature_definitions (
  feature_key TEXT PRIMARY KEY CHECK (feature_key ~ '^[a-z][a-z0-9-]*$'),
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  is_baseline BOOLEAN NOT NULL DEFAULT FALSE,
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO feature_definitions (feature_key, label, description, is_baseline, display_order) VALUES
  ('booking-essentials', 'Booking essentials', 'Services, eligible staff, availability, public booking, holds, and confirmations.', TRUE, 10),
  ('clients', 'Clients', 'Customer records and booking history.', FALSE, 20),
  ('team', 'Team', 'Employee records and tenant roles.', FALSE, 30),
  ('calendars', 'Calendars', 'Working hours, breaks, holidays, and blackout dates.', FALSE, 40),
  ('resources', 'Resources', 'Rooms, chairs, and equipment scheduling.', FALSE, 50),
  ('email-notifications', 'Email notifications', 'Confirmation and cancellation delivery.', FALSE, 60)
ON CONFLICT (feature_key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_baseline = EXCLUDED.is_baseline,
  display_order = EXCLUDED.display_order;

CREATE TABLE IF NOT EXISTS plan_feature_defaults (
  plan TEXT NOT NULL CHECK (plan IN ('starter', 'growth')),
  feature_key TEXT NOT NULL REFERENCES feature_definitions(feature_key) ON DELETE RESTRICT,
  is_enabled BOOLEAN NOT NULL,
  PRIMARY KEY (plan, feature_key)
);

INSERT INTO plan_feature_defaults (plan, feature_key, is_enabled)
SELECT plan.plan, feature.feature_key,
  CASE
    WHEN feature.feature_key IN ('booking-essentials', 'clients', 'team', 'calendars') THEN TRUE
    WHEN plan.plan = 'growth' AND feature.feature_key IN ('resources', 'email-notifications') THEN TRUE
    ELSE FALSE
  END
FROM (VALUES ('starter'), ('growth')) AS plan(plan)
CROSS JOIN feature_definitions feature
ON CONFLICT (plan, feature_key) DO UPDATE SET is_enabled = EXCLUDED.is_enabled;

CREATE TABLE IF NOT EXISTS tenant_feature_states (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES feature_definitions(feature_key) ON DELETE RESTRICT,
  is_enabled BOOLEAN NOT NULL,
  updated_by_identity_id UUID REFERENCES identities(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, feature_key)
);
CREATE INDEX IF NOT EXISTS tenant_feature_states_tenant_idx ON tenant_feature_states(tenant_id, feature_key);

INSERT INTO tenant_feature_states (tenant_id, feature_key, is_enabled)
SELECT tenant.id, defaults.feature_key, defaults.is_enabled
FROM tenants tenant
JOIN plan_feature_defaults defaults ON defaults.plan = tenant.plan
ON CONFLICT (tenant_id, feature_key) DO NOTHING;
