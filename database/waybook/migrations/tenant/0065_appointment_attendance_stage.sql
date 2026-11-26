-- Keep 'arrived' as the booking status for reports, pricing, and older clients.
-- A NULL stage on an arrived booking is the existing in-service behaviour.
ALTER TABLE bookings ADD COLUMN attendance_stage TEXT;
ALTER TABLE bookings ADD CONSTRAINT booking_attendance_stage_valid CHECK (
  attendance_stage IS NULL OR (status = 'arrived' AND attendance_stage IN ('waiting_room', 'in_service', 'checking_out'))
);

CREATE FUNCTION enforce_booking_attendance_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> 'arrived' THEN
    NEW.attendance_stage := NULL;
  ELSIF NEW.attendance_stage IS DISTINCT FROM OLD.attendance_stage THEN
    IF (OLD.status = 'confirmed' AND NEW.attendance_stage IN ('waiting_room', 'in_service'))
      OR (OLD.status = 'arrived' AND OLD.attendance_stage = 'waiting_room' AND NEW.attendance_stage = 'in_service')
      OR (OLD.status = 'arrived' AND coalesce(OLD.attendance_stage, 'in_service') = 'in_service' AND NEW.attendance_stage = 'checking_out') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid appointment attendance stage transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER booking_attendance_stage_transition
BEFORE UPDATE OF status, attendance_stage ON bookings
FOR EACH ROW EXECUTE FUNCTION enforce_booking_attendance_stage();
