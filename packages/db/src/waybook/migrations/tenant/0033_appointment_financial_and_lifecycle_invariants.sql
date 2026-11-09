-- Appointment payments predate commerce_sales, but remain a real immutable
-- ledger. Lock the booking row so simultaneous payment/refund submissions
-- cannot over-collect or over-refund it.

CREATE OR REPLACE FUNCTION enforce_booking_payment_record() RETURNS trigger AS $$
DECLARE
  booking_status TEXT;
  booked_price INTEGER;
  paid_cents INTEGER;
  refunded_cents INTEGER;
BEGIN
  SELECT status, booked_price_cents INTO booking_status, booked_price
  FROM bookings
  WHERE id = NEW.booking_id AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment record must belong to a booking in the same tenant';
  END IF;
  SELECT coalesce(sum(amount_cents) FILTER (WHERE kind='payment'),0)::int,
         coalesce(sum(amount_cents) FILTER (WHERE kind='refund'),0)::int
    INTO paid_cents, refunded_cents
  FROM payment_records
  WHERE tenant_id=NEW.tenant_id AND booking_id=NEW.booking_id;

  IF NEW.kind = 'payment' THEN
    IF booking_status = 'cancelled' THEN
      RAISE EXCEPTION 'cancelled appointments cannot receive payment';
    END IF;
    IF paid_cents - refunded_cents + NEW.amount_cents > booked_price THEN
      RAISE EXCEPTION 'appointment payment cannot exceed booked service value';
    END IF;
  ELSIF NEW.kind = 'refund' THEN
    IF NEW.amount_cents > paid_cents - refunded_cents THEN
      RAISE EXCEPTION 'appointment refund cannot exceed collected payment';
    END IF;
  ELSE
    RAISE EXCEPTION 'payment record kind is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_payment_record_lifecycle ON payment_records;
CREATE TRIGGER booking_payment_record_lifecycle
  BEFORE INSERT ON payment_records
  FOR EACH ROW EXECUTE FUNCTION enforce_booking_payment_record();

CREATE OR REPLACE FUNCTION enforce_booking_status_transition() RETURNS trigger AS $$
BEGIN
  IF NEW.status = OLD.status THEN
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

DROP TRIGGER IF EXISTS booking_status_transition_lifecycle ON bookings;
CREATE TRIGGER booking_status_transition_lifecycle
  BEFORE UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION enforce_booking_status_transition();
