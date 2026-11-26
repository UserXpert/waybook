-- Keep appointment receipts in payment_records. The cart determines the
-- collectible amount, while the booked service price remains historical.
CREATE FUNCTION appointment_checkout_amounts(target_tenant UUID, target_booking UUID)
RETURNS TABLE (product_cents BIGINT, chargeable_cents BIGINT, package_redeemed BOOLEAN)
LANGUAGE sql STABLE AS $$
  SELECT products.cents,
         products.cents + CASE WHEN coverage.redeemed THEN 0 ELSE b.booked_price_cents END + b.no_show_charge_cents,
         coverage.redeemed
  FROM bookings b
  CROSS JOIN LATERAL (
    SELECT coalesce(sum(line.unit_price_cents::bigint * line.quantity - line.discount_cents), 0)::bigint AS cents
    FROM commerce_sales sale
    JOIN commerce_sale_lines line ON line.tenant_id = sale.tenant_id AND line.sale_id = sale.id
    WHERE sale.tenant_id = b.tenant_id AND sale.booking_id = b.id AND line.line_kind = 'product'
  ) products
  CROSS JOIN LATERAL (
    SELECT EXISTS (
      SELECT 1 FROM commerce_entitlement_entries entry
      WHERE entry.tenant_id = b.tenant_id AND entry.booking_id = b.id
        AND entry.kind = 'redeem' AND entry.package_id IS NOT NULL
    ) AS redeemed
  ) coverage
  WHERE b.tenant_id = target_tenant AND b.id = target_booking;
$$;

CREATE OR REPLACE FUNCTION enforce_booking_payment_record() RETURNS trigger AS $$
DECLARE
  booking_status TEXT;
  total RECORD;
  net_paid BIGINT;
BEGIN
  SELECT status INTO booking_status
  FROM bookings WHERE id = NEW.booking_id AND tenant_id = NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment record must belong to a booking in the same tenant'; END IF;
  SELECT coalesce(sum(CASE WHEN kind = 'payment' THEN amount_cents ELSE -amount_cents END), 0)
  INTO net_paid FROM payment_records WHERE tenant_id = NEW.tenant_id AND booking_id = NEW.booking_id;
  IF NEW.kind = 'payment' THEN
    IF booking_status = 'cancelled' THEN RAISE EXCEPTION 'cancelled appointments cannot receive payment'; END IF;
    SELECT * INTO total FROM appointment_checkout_amounts(NEW.tenant_id, NEW.booking_id);
    IF total.package_redeemed AND total.chargeable_cents = 0 THEN
      RAISE EXCEPTION 'package-redeemed appointments cannot receive payment without a chargeable balance';
    END IF;
    IF net_paid + NEW.amount_cents > total.chargeable_cents THEN
      IF total.product_cents = 0 THEN RAISE EXCEPTION 'appointment payment cannot exceed booked service value'; END IF;
      RAISE EXCEPTION 'appointment payment cannot exceed the checkout total';
    END IF;
  ELSIF NEW.kind = 'refund' THEN
    IF NEW.amount_cents > net_paid THEN RAISE EXCEPTION 'appointment refund cannot exceed collected payment'; END IF;
  ELSE
    RAISE EXCEPTION 'payment record kind is invalid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_booking_product_addon_lifecycle() RETURNS trigger AS $$
DECLARE
  appointment RECORD;
BEGIN
  FOR appointment IN
    SELECT DISTINCT sale.tenant_id, sale.booking_id
    FROM commerce_sales sale
    WHERE sale.booking_id IS NOT NULL AND (
      (TG_OP <> 'INSERT' AND OLD.line_kind = 'product' AND sale.tenant_id = OLD.tenant_id AND sale.id = OLD.sale_id)
      OR (TG_OP <> 'DELETE' AND NEW.line_kind = 'product' AND sale.tenant_id = NEW.tenant_id AND sale.id = NEW.sale_id)
    )
    ORDER BY sale.tenant_id, sale.booking_id
  LOOP
    PERFORM 1 FROM bookings
    WHERE id = appointment.booking_id AND tenant_id = appointment.tenant_id
      AND status IN ('confirmed', 'arrived') FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'products can only be changed on confirmed or arrived appointments';
    END IF;
    IF EXISTS (
      SELECT 1 FROM payment_records WHERE tenant_id = appointment.tenant_id AND booking_id = appointment.booking_id
    ) THEN
      RAISE EXCEPTION 'products cannot be changed after an appointment payment has been recorded';
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER booking_product_addon_lifecycle ON commerce_sale_lines;
CREATE TRIGGER booking_product_addon_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON commerce_sale_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_booking_product_addon_lifecycle();
