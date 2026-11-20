-- A package is a full-service tender for one appointment.  The debit is tied
-- to both its booking and booking-owned commerce sale so it cannot be reused
-- or silently applied to a different client/service.

CREATE UNIQUE INDEX IF NOT EXISTS commerce_package_redemption_once_per_booking_idx
  ON commerce_entitlement_entries (tenant_id, booking_id)
  WHERE kind = 'redeem' AND package_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_booking_package_redemption() RETURNS trigger AS $$
DECLARE
  appointment_status TEXT;
  appointment_customer_id UUID;
  appointment_service_id UUID;
BEGIN
  IF NEW.package_id IS NULL OR NEW.kind <> 'redeem' THEN
    RETURN NEW;
  END IF;

  IF NEW.booking_id IS NULL OR NEW.sale_id IS NULL OR NEW.units <> 1 THEN
    RAISE EXCEPTION 'package redemption requires one booking, sale, and visit';
  END IF;

  SELECT b.status, b.customer_id, b.service_id
    INTO appointment_status, appointment_customer_id, appointment_service_id
  FROM bookings b
  JOIN commerce_sales cs ON cs.id = NEW.sale_id
    AND cs.tenant_id = b.tenant_id
    AND cs.booking_id = b.id
  WHERE b.id = NEW.booking_id AND b.tenant_id = NEW.tenant_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'package redemption sale must belong to its booking in the same tenant';
  END IF;
  IF appointment_status NOT IN ('confirmed', 'arrived') THEN
    RAISE EXCEPTION 'packages can only be redeemed for confirmed or arrived appointments';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM commerce_packages
    WHERE id = NEW.package_id AND tenant_id = NEW.tenant_id AND customer_id = appointment_customer_id
  ) THEN
    RAISE EXCEPTION 'package redemption client must match the appointment client';
  END IF;
  IF NEW.service_id <> appointment_service_id THEN
    RAISE EXCEPTION 'package redemption service must match the appointment service';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payment_records
    WHERE tenant_id = NEW.tenant_id AND booking_id = NEW.booking_id
  ) THEN
    RAISE EXCEPTION 'package redemption requires an appointment without payment entries';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_package_redemption_lifecycle ON commerce_entitlement_entries;
CREATE TRIGGER booking_package_redemption_lifecycle
  BEFORE INSERT ON commerce_entitlement_entries
  FOR EACH ROW EXECUTE FUNCTION enforce_booking_package_redemption();

-- Keep package and cash/card tender mutually exclusive until a dedicated
-- mixed-tender/refund lifecycle exists.
CREATE OR REPLACE FUNCTION enforce_booking_payment_record() RETURNS trigger AS $$
DECLARE
  booking_status TEXT;
  booked_price INTEGER;
  paid_cents INTEGER;
  refunded_cents INTEGER;
BEGIN
  SELECT status, booked_price_cents INTO booking_status, booked_price
  FROM bookings WHERE id = NEW.booking_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment record must belong to a booking in the same tenant'; END IF;
  IF NEW.kind = 'payment' AND EXISTS (
    SELECT 1 FROM commerce_entitlement_entries
    WHERE tenant_id = NEW.tenant_id AND booking_id = NEW.booking_id AND kind = 'redeem' AND package_id IS NOT NULL
  ) THEN RAISE EXCEPTION 'package-redeemed appointments cannot receive payment'; END IF;
  SELECT coalesce(sum(amount_cents) FILTER (WHERE kind='payment'),0)::int,
         coalesce(sum(amount_cents) FILTER (WHERE kind='refund'),0)::int
    INTO paid_cents, refunded_cents FROM payment_records
    WHERE tenant_id=NEW.tenant_id AND booking_id=NEW.booking_id;
  IF NEW.kind = 'payment' THEN
    IF booking_status = 'cancelled' THEN RAISE EXCEPTION 'cancelled appointments cannot receive payment'; END IF;
    IF paid_cents - refunded_cents + NEW.amount_cents > booked_price THEN RAISE EXCEPTION 'appointment payment cannot exceed booked service value'; END IF;
  ELSIF NEW.kind = 'refund' THEN
    IF NEW.amount_cents > paid_cents - refunded_cents THEN RAISE EXCEPTION 'appointment refund cannot exceed collected payment'; END IF;
  ELSE RAISE EXCEPTION 'payment record kind is invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
