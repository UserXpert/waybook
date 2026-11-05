ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS job_title TEXT,
  ADD COLUMN IF NOT EXISTS specialty TEXT,
  ADD COLUMN IF NOT EXISTS work_location TEXT,
  ADD COLUMN IF NOT EXISTS staff_code TEXT,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS team_members_tenant_staff_code_unique
  ON team_members (tenant_id, staff_code)
  WHERE staff_code IS NOT NULL;
