-- Provider-initiated refunds carry a Stripe ID and no Waybook operator identity.
ALTER TABLE stripe_sandbox_refund_attempts
  ALTER COLUMN created_by_identity_id DROP NOT NULL,
  ADD CHECK (created_by_identity_id IS NOT NULL OR refund_id IS NOT NULL);

DROP INDEX stripe_sandbox_one_pending_refund;
CREATE UNIQUE INDEX stripe_sandbox_one_pending_refund
  ON stripe_sandbox_refund_attempts (payment_attempt_id)
  WHERE state = 'pending' AND created_by_identity_id IS NOT NULL;

CREATE OR REPLACE FUNCTION is_stripe_sandbox_refund_return(
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
      AND r.created_by_identity_id IS NOT DISTINCT FROM actor
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
        AND r.amount_cents = NEW.amount_cents AND r.created_by_identity_id IS NOT DISTINCT FROM NEW.recorded_by_identity_id
    ))
    OR is_stripe_sandbox_refund_return(NEW.tenant_id, NEW.booking_id, NEW.id, NEW.method,
      NEW.kind, NEW.amount_cents, NEW.recorded_by_identity_id)
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Stripe sandbox payments must be reconciled through Stripe.';
END;
$$;
