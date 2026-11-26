ALTER TABLE waybook_staff_invitations
  ADD COLUMN email_request_id UUID UNIQUE;
