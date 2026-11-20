-- A booking has exactly one commerce identity. It is a read-model bridge only:
-- payment_records remains the single appointment-payment ledger until a later
-- atomic booking-tender slice explicitly introduces commerce transactions.

CREATE OR REPLACE FUNCTION ensure_booking_commerce_sale() RETURNS trigger AS $$
BEGIN
  INSERT INTO commerce_sales (tenant_id, booking_id, customer_id, location_id, status, currency)
  SELECT NEW.tenant_id, NEW.id, NEW.customer_id, NEW.location_id, 'open', settings.currency
  FROM tenant_settings settings
  WHERE settings.tenant_id = NEW.tenant_id
  ON CONFLICT (tenant_id, booking_id) WHERE booking_id IS NOT NULL DO NOTHING;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking commerce sale requires tenant settings in the same tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_commerce_sale_after_insert ON bookings;
CREATE TRIGGER booking_commerce_sale_after_insert
  AFTER INSERT ON bookings
  FOR EACH ROW EXECUTE FUNCTION ensure_booking_commerce_sale();

INSERT INTO commerce_sales (tenant_id, booking_id, customer_id, location_id, status, currency)
SELECT b.tenant_id, b.id, b.customer_id, b.location_id, 'open', settings.currency
FROM bookings b
JOIN tenant_settings settings ON settings.tenant_id = b.tenant_id
LEFT JOIN commerce_sales sale ON sale.tenant_id = b.tenant_id AND sale.booking_id = b.id
WHERE sale.id IS NULL;
