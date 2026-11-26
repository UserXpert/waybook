ALTER TABLE staff_access_requests
  ADD COLUMN receipt_hash TEXT,
  ADD COLUMN email_started_at TIMESTAMPTZ,
  ADD COLUMN email_sender TEXT,
  ADD COLUMN email_origin TEXT,
  ADD COLUMN email_workspace_name TEXT,
  ADD CONSTRAINT staff_access_request_email_snapshot CHECK (
    (email_started_at IS NULL AND email_sender IS NULL AND email_origin IS NULL AND email_workspace_name IS NULL)
    OR (email_started_at IS NOT NULL AND email_sender IS NOT NULL AND email_origin IS NOT NULL AND email_workspace_name IS NOT NULL)
  );
