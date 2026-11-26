ALTER TABLE staff_access_requests
  ADD COLUMN email_send_number INTEGER NOT NULL DEFAULT 0 CHECK (email_send_number >= 0),
  ADD COLUMN email_accepted_number INTEGER CHECK (
    email_accepted_number IS NULL OR email_accepted_number BETWEEN 0 AND email_send_number
  );

UPDATE staff_access_requests SET email_accepted_number = 0
WHERE invited_at IS NOT NULL AND email_started_at IS NOT NULL;
