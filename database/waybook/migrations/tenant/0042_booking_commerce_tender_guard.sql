-- Booking payments currently belong to payment_records.  A booking-owned
-- commerce sale is a read model (0036), not a separate checkout.  Enforce
-- that boundary so cancellation cannot race an unrelated tender write.
CREATE OR REPLACE FUNCTION guard_booking_sale_tender() RETURNS trigger AS $$
DECLARE
  linked_booking UUID;
BEGIN
  SELECT booking_id INTO linked_booking FROM commerce_sales
  WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id FOR UPDATE;
  IF NEW.kind='payment' AND linked_booking IS NOT NULL THEN
    RAISE EXCEPTION 'booking payments must be recorded in the appointment ledger';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS booking_sale_tender_guard ON commerce_sale_transactions;
CREATE TRIGGER booking_sale_tender_guard BEFORE INSERT ON commerce_sale_transactions
  FOR EACH ROW EXECUTE FUNCTION guard_booking_sale_tender();

CREATE OR REPLACE FUNCTION guard_sale_booking_identity() RETURNS trigger AS $$
BEGIN
  IF NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
    RAISE EXCEPTION 'a sale cannot be attached to or detached from a booking';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS commerce_sale_booking_identity_guard ON commerce_sales;
CREATE TRIGGER commerce_sale_booking_identity_guard BEFORE UPDATE OF booking_id ON commerce_sales
  FOR EACH ROW EXECUTE FUNCTION guard_sale_booking_identity();
