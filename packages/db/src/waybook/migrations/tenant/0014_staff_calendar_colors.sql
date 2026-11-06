ALTER TABLE team_members
  ADD COLUMN IF NOT EXISTS calendar_color TEXT NOT NULL DEFAULT '#67c7cf'
  CHECK (calendar_color ~ '^#[0-9A-Fa-f]{6}$');
