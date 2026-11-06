CREATE TABLE IF NOT EXISTS staff_permissions (
  tenant_id UUID NOT NULL,
  team_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  can_update_appointment_status BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_own_appointments BOOLEAN NOT NULL DEFAULT FALSE,
  can_view_team_calendar BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_team_appointments BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_own_time_off BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_team_time_off BOOLEAN NOT NULL DEFAULT FALSE,
  can_manage_waitlist BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, team_member_id)
);
