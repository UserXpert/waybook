-- The primary service remains on bookings. Added services reserve their
-- own capacity while receipts, attendance, and the booking number stay on
-- the original appointment.
CREATE TABLE booking_service_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  booking_block_id UUID NOT NULL UNIQUE REFERENCES booking_blocks(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 2),
  booked_price_cents INTEGER NOT NULL CHECK (booked_price_cents >= 0),
  UNIQUE (tenant_id, booking_id, position)
);

CREATE FUNCTION enforce_booking_service_segment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  appointment bookings%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.tenant_id, OLD.booking_id, OLD.booking_block_id)
      IS DISTINCT FROM (NEW.tenant_id, NEW.booking_id, NEW.booking_block_id) THEN
    RAISE EXCEPTION 'a service segment cannot be moved to a different appointment or reservation';
  END IF;

  SELECT * INTO appointment FROM bookings
  WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
    AND id = COALESCE(NEW.booking_id, OLD.booking_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'a service segment must belong to an appointment in the same tenant';
  END IF;
  IF appointment.status NOT IN ('confirmed', 'arrived') OR EXISTS (
    SELECT 1 FROM payment_records WHERE tenant_id = appointment.tenant_id AND booking_id = appointment.id
  ) THEN
    RAISE EXCEPTION 'services cannot be changed after an appointment is closed or a payment has been recorded';
  END IF;
  IF TG_OP = 'DELETE' THEN
    UPDATE booking_blocks SET state = 'released' WHERE tenant_id = OLD.tenant_id AND id = OLD.booking_block_id;
    RETURN OLD;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM booking_blocks block
    JOIN services service ON service.tenant_id = block.tenant_id AND service.id = NEW.service_id
    WHERE block.tenant_id = NEW.tenant_id AND block.id = NEW.booking_block_id
      AND block.location_id = appointment.location_id AND block.state = 'confirmed'
      AND block.team_member_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM bookings primary_booking WHERE primary_booking.booking_block_id = block.id
      )
  ) THEN
    RAISE EXCEPTION 'a service segment requires a separate confirmed reservation at the appointment location';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER booking_service_segment_integrity
BEFORE INSERT OR UPDATE OR DELETE ON booking_service_segments
FOR EACH ROW EXECUTE FUNCTION enforce_booking_service_segment();

CREATE FUNCTION cancel_linked_appointment_reservations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE booking_blocks block SET state = 'cancelled'
  FROM booking_service_segments segment
  WHERE segment.tenant_id = NEW.tenant_id AND segment.booking_id = NEW.id
    AND block.tenant_id = segment.tenant_id AND block.id = segment.booking_block_id
    AND block.state = 'confirmed';
  RETURN NEW;
END;
$$;

CREATE TRIGGER cancel_linked_appointment_reservations
AFTER UPDATE OF status ON bookings
FOR EACH ROW WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION cancel_linked_appointment_reservations();

CREATE OR REPLACE FUNCTION appointment_checkout_amounts(target_tenant UUID, target_booking UUID)
RETURNS TABLE (product_cents BIGINT, chargeable_cents BIGINT, package_redeemed BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT products.cents,
         products.cents + extra_services.cents
           + CASE WHEN coverage.redeemed THEN 0 ELSE b.booked_price_cents END + b.no_show_charge_cents,
         coverage.redeemed
  FROM bookings b
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(line.unit_price_cents::bigint * line.quantity - line.discount_cents), 0)::bigint AS cents
    FROM commerce_sales sale
    JOIN commerce_sale_lines line ON line.tenant_id = sale.tenant_id AND line.sale_id = sale.id
    WHERE sale.tenant_id = b.tenant_id AND sale.booking_id = b.id AND line.line_kind = 'product'
  ) products
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(segment.booked_price_cents), 0)::bigint AS cents
    FROM booking_service_segments segment
    WHERE segment.tenant_id = b.tenant_id AND segment.booking_id = b.id
  ) extra_services
  CROSS JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM commerce_entitlement_entries entry
      WHERE entry.tenant_id = b.tenant_id AND entry.booking_id = b.id
        AND entry.kind = 'redeem' AND entry.package_id IS NOT NULL
    ) AS redeemed
  ) coverage
  WHERE b.tenant_id = target_tenant AND b.id = target_booking;
$$;
