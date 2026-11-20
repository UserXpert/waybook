-- Keep an auditable, reversible distinction between a temporarily inactive
-- staff profile and an archived former team member.
ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS team_members_tenant_archived_idx
  ON team_members (tenant_id, archived_at)
  WHERE archived_at IS NOT NULL;
