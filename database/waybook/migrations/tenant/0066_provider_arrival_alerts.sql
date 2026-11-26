ALTER TABLE tenant_settings ADD COLUMN provider_arrival_alerts_enabled BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE provider_arrival_alerts (
  tenant_id UUID NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  team_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE RESTRICT,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, booking_id, team_member_id)
);

CREATE INDEX provider_arrival_alerts_inbox_idx
  ON provider_arrival_alerts (tenant_id, team_member_id, notified_at DESC);
