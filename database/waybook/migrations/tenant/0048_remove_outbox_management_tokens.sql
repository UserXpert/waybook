-- Booking management uses the booking number and email; the delivery worker
-- never needs the raw management token in outbox payloads.
UPDATE email_outbox SET payload = payload - 'managementToken'
WHERE jsonb_typeof(payload) = 'object' AND payload ? 'managementToken';

-- Older outbox rows may contain an object encoded as a JSON string. Preserve
-- that representation, and leave malformed legacy values untouched.
CREATE OR REPLACE FUNCTION pg_temp.remove_outbox_token(value JSONB) RETURNS JSONB
LANGUAGE plpgsql AS $$
DECLARE parsed JSONB;
BEGIN
  IF jsonb_typeof(value) <> 'string' THEN RETURN value; END IF;
  BEGIN parsed := (value #>> '{}')::jsonb;
  EXCEPTION WHEN invalid_text_representation THEN RETURN value; END;
  IF jsonb_typeof(parsed) = 'object' AND parsed ? 'managementToken' THEN
    RETURN to_jsonb((parsed - 'managementToken')::text);
  END IF;
  RETURN value;
END $$;
UPDATE email_outbox SET payload = pg_temp.remove_outbox_token(payload)
WHERE jsonb_typeof(payload) = 'string' AND payload::text LIKE '%managementToken%';
