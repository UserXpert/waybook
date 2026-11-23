CREATE OR REPLACE FUNCTION enforce_booking_status_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  -- Record actual attendance without reopening the booking or reserving resources again.
  IF OLD.status = 'no_show' AND NEW.status = 'completed' AND OLD.ends_at <= clock_timestamp() THEN
    RETURN NEW;
  END IF;
  IF OLD.status IN ('completed', 'cancelled', 'no_show') THEN
    RAISE EXCEPTION 'terminal appointment statuses cannot be changed';
  END IF;
  IF OLD.status = 'confirmed' AND NEW.status IN ('arrived', 'completed', 'no_show', 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'arrived' AND NEW.status IN ('completed', 'no_show', 'cancelled') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invalid appointment status transition from % to %', OLD.status, NEW.status;
END;
$$ LANGUAGE plpgsql;
