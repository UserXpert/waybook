ALTER TABLE team_members
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD CONSTRAINT team_members_deleted_profile_inactive
    CHECK (deleted_at IS NULL OR (NOT is_active AND archived_at IS NOT NULL AND role <> 'owner'));
