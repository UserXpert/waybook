-- Booking product lines may be added only while the appointment is still
-- operationally active. Retail sales (which have no booking_id) retain their
-- existing lifecycle, and closed/void sale-line immutability remains enforced
-- by the earlier commerce trigger.

CREATE OR REPLACE FUNCTION enforce_booking_product_addon_lifecycle() RETURNS trigger AS $$
DECLARE
  appointment_status TEXT;
BEGIN
  IF NEW.line_kind <> 'product' THEN
    RETURN NEW;
  END IF;

  SELECT b.status INTO appointment_status
  FROM commerce_sales cs
  JOIN bookings b ON b.id = cs.booking_id AND b.tenant_id = cs.tenant_id
  WHERE cs.id = NEW.sale_id AND cs.tenant_id = NEW.tenant_id
  FOR SHARE;

  IF FOUND AND appointment_status NOT IN ('confirmed', 'arrived') THEN
    RAISE EXCEPTION 'products can only be added to confirmed or arrived appointments';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_product_addon_lifecycle ON commerce_sale_lines;
CREATE TRIGGER booking_product_addon_lifecycle
  BEFORE INSERT ON commerce_sale_lines
  FOR EACH ROW EXECUTE FUNCTION enforce_booking_product_addon_lifecycle();
