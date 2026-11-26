-- Keep manager-entered no-show charges separate from the original service price.
ALTER TABLE bookings ADD COLUMN no_show_charge_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD CONSTRAINT bookings_no_show_charge_valid CHECK (
  no_show_charge_cents = 0 OR
  (no_show_charge_cents BETWEEN 1 AND 10000000 AND booked_price_cents = 0 AND status IN ('no_show', 'completed'))
);

CREATE OR REPLACE FUNCTION enforce_booking_payment_record() RETURNS trigger AS $$
DECLARE
  booking_status TEXT;
  chargeable_amount INTEGER;
  paid_cents INTEGER;
  refunded_cents INTEGER;
BEGIN
  SELECT status, booked_price_cents + no_show_charge_cents INTO booking_status, chargeable_amount
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
    IF paid_cents - refunded_cents + NEW.amount_cents > chargeable_amount THEN RAISE EXCEPTION 'appointment payment cannot exceed booked service value'; END IF;
  ELSIF NEW.kind = 'refund' THEN
    IF NEW.amount_cents > paid_cents - refunded_cents THEN RAISE EXCEPTION 'appointment refund cannot exceed collected payment'; END IF;
  ELSE RAISE EXCEPTION 'payment record kind is invalid'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
