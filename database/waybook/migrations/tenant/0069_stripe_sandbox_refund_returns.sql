ALTER TABLE stripe_sandbox_refund_attempts
  ADD COLUMN return_payment_id UUID UNIQUE REFERENCES payment_records(id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN failure_balance_transaction_id TEXT UNIQUE
    CHECK (failure_balance_transaction_id ~ '^txn_[A-Za-z0-9]+$'),
  ADD CHECK ((return_payment_id IS NULL) = (failure_balance_transaction_id IS NULL)),
  ADD CHECK (return_payment_id IS NULL OR state = 'failed');

CREATE FUNCTION is_stripe_sandbox_refund_return(
  target_tenant UUID, target_booking UUID, entry_id UUID, tender TEXT,
  entry_kind TEXT, cents INTEGER, actor UUID
) RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT entry_kind = 'payment' AND tender = 'card' AND EXISTS (
    SELECT 1
    FROM stripe_sandbox_refund_attempts r
    JOIN stripe_sandbox_checkout_attempts p ON p.id = r.payment_attempt_id
    JOIN payment_records original ON original.id = r.id AND original.tenant_id = p.tenant_id
      AND original.booking_id = p.booking_id AND original.kind = 'refund' AND original.method = 'card'
    WHERE p.tenant_id = target_tenant AND p.booking_id = target_booking AND p.state = 'settled'
      AND r.return_payment_id = entry_id AND r.state = 'failed'
      AND r.amount_cents = cents AND original.amount_cents = cents
      AND r.created_by_identity_id = actor
  );
$$;

CREATE OR REPLACE FUNCTION guard_stripe_sandbox_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  attempt stripe_sandbox_checkout_attempts%ROWTYPE;
BEGIN
  PERFORM assert_stripe_checkout_not_pending(NEW.tenant_id, NEW.booking_id);
  SELECT * INTO attempt FROM stripe_sandbox_checkout_attempts
  WHERE tenant_id = NEW.tenant_id AND booking_id = NEW.booking_id AND state = 'settled';
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF NEW.method = 'card' AND (
    (NEW.kind = 'payment' AND NEW.id = attempt.id AND NEW.amount_cents = attempt.amount_cents
      AND NEW.recorded_by_identity_id = attempt.created_by_identity_id)
    OR (NEW.kind = 'refund' AND EXISTS (
      SELECT 1 FROM stripe_sandbox_refund_attempts r
      WHERE r.id = NEW.id AND r.payment_attempt_id = attempt.id AND r.state = 'succeeded'
        AND r.amount_cents = NEW.amount_cents AND r.created_by_identity_id = NEW.recorded_by_identity_id
    ))
    OR is_stripe_sandbox_refund_return(NEW.tenant_id, NEW.booking_id, NEW.id, NEW.method,
      NEW.kind, NEW.amount_cents, NEW.recorded_by_identity_id)
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Stripe sandbox payments must be reconciled through Stripe.';
END;
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
  -- A provider-confirmed refund return restores a historical receipt, even on a cancelled booking.
  IF is_stripe_sandbox_refund_return(NEW.tenant_id, NEW.booking_id, NEW.id, NEW.method,
      NEW.kind, NEW.amount_cents, NEW.recorded_by_identity_id) THEN RETURN NEW; END IF;
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
