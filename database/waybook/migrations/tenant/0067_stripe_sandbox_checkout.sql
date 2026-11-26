CREATE TABLE stripe_sandbox_checkout_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  account_id TEXT NOT NULL CHECK (account_id ~ '^acct_[A-Za-z0-9]+$'),
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 10000000),
  return_path TEXT NOT NULL,
  return_origin TEXT NOT NULL,
  created_by_identity_id UUID NOT NULL,
  expires_at_seconds INTEGER NOT NULL,
  session_id TEXT UNIQUE CHECK (session_id ~ '^cs_test_[A-Za-z0-9]+$'),
  payment_intent_id TEXT UNIQUE CHECK (payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'settled', 'expired')),
  CHECK ((state = 'settled') = (payment_intent_id IS NOT NULL)),
  CHECK (state = 'pending' OR session_id IS NOT NULL)
);

CREATE UNIQUE INDEX stripe_sandbox_checkout_current
  ON stripe_sandbox_checkout_attempts (tenant_id, booking_id) WHERE state <> 'expired';

-- The appointment lock is shared with the regular payment and cart triggers.
CREATE FUNCTION assert_stripe_checkout_not_pending(target_tenant UUID, target_booking UUID)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM bookings WHERE tenant_id = target_tenant AND id = target_booking FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM stripe_sandbox_checkout_attempts
    WHERE tenant_id = target_tenant AND booking_id = target_booking AND state = 'pending'
  ) THEN
    RAISE EXCEPTION 'Resolve the open Stripe sandbox payment before changing checkout.';
  END IF;
END;
$$;

CREATE FUNCTION guard_stripe_sandbox_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempt stripe_sandbox_checkout_attempts%ROWTYPE;
BEGIN
  PERFORM assert_stripe_checkout_not_pending(NEW.tenant_id, NEW.booking_id);
  SELECT * INTO attempt FROM stripe_sandbox_checkout_attempts
  WHERE tenant_id = NEW.tenant_id AND booking_id = NEW.booking_id AND state = 'settled';
  IF FOUND AND (NEW.id <> attempt.id OR NEW.kind <> 'payment' OR NEW.method <> 'card'
      OR NEW.amount_cents <> attempt.amount_cents
      OR NEW.recorded_by_identity_id IS DISTINCT FROM attempt.created_by_identity_id) THEN
    RAISE EXCEPTION 'Stripe sandbox payments must be reconciled through Stripe.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stripe_sandbox_payment_guard BEFORE INSERT ON payment_records
  FOR EACH ROW EXECUTE FUNCTION guard_stripe_sandbox_payment();

CREATE FUNCTION guard_stripe_sandbox_booking_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.status, OLD.attendance_stage, OLD.booked_price_cents, OLD.no_show_charge_cents)
      IS DISTINCT FROM
     (NEW.status, NEW.attendance_stage, NEW.booked_price_cents, NEW.no_show_charge_cents)
     AND EXISTS (
       SELECT 1 FROM stripe_sandbox_checkout_attempts
       WHERE tenant_id = OLD.tenant_id AND booking_id = OLD.id AND state = 'pending'
     ) THEN
    RAISE EXCEPTION 'Resolve the open Stripe sandbox payment before changing checkout.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stripe_sandbox_booking_guard BEFORE UPDATE OF status, attendance_stage,
  booked_price_cents, no_show_charge_cents ON bookings
  FOR EACH ROW EXECUTE FUNCTION guard_stripe_sandbox_booking_change();

CREATE FUNCTION guard_stripe_sandbox_cart() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  appointment RECORD;
BEGIN
  IF TG_TABLE_NAME = 'commerce_sale_lines' THEN
    FOR appointment IN
      SELECT DISTINCT sale.tenant_id, sale.booking_id
      FROM commerce_sales sale
      WHERE sale.booking_id IS NOT NULL AND (
        (TG_OP <> 'INSERT' AND OLD.line_kind = 'product' AND sale.tenant_id = OLD.tenant_id AND sale.id = OLD.sale_id)
        OR (TG_OP <> 'DELETE' AND NEW.line_kind = 'product' AND sale.tenant_id = NEW.tenant_id AND sale.id = NEW.sale_id)
      )
      ORDER BY sale.tenant_id, sale.booking_id
    LOOP
      PERFORM assert_stripe_checkout_not_pending(appointment.tenant_id, appointment.booking_id);
    END LOOP;
  ELSIF TG_TABLE_NAME = 'booking_service_segments' THEN
    PERFORM assert_stripe_checkout_not_pending(COALESCE(NEW.tenant_id, OLD.tenant_id), COALESCE(NEW.booking_id, OLD.booking_id));
  ELSIF NEW.kind = 'redeem' AND NEW.booking_id IS NOT NULL AND NEW.package_id IS NOT NULL THEN
    PERFORM assert_stripe_checkout_not_pending(NEW.tenant_id, NEW.booking_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER stripe_sandbox_cart_guard BEFORE INSERT OR UPDATE OR DELETE ON commerce_sale_lines
  FOR EACH ROW EXECUTE FUNCTION guard_stripe_sandbox_cart();
CREATE TRIGGER stripe_sandbox_service_guard BEFORE INSERT OR UPDATE OR DELETE ON booking_service_segments
  FOR EACH ROW EXECUTE FUNCTION guard_stripe_sandbox_cart();
CREATE TRIGGER stripe_sandbox_package_guard BEFORE INSERT ON commerce_entitlement_entries
  FOR EACH ROW EXECUTE FUNCTION guard_stripe_sandbox_cart();
