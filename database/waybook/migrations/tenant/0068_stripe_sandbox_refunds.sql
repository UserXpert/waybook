CREATE TABLE stripe_sandbox_refund_attempts (
  id UUID PRIMARY KEY,
  payment_attempt_id UUID NOT NULL REFERENCES stripe_sandbox_checkout_attempts(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 10000000),
  created_by_identity_id UUID NOT NULL,
  refund_id TEXT UNIQUE CHECK (refund_id ~ '^re_[A-Za-z0-9]+$'),
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'succeeded', 'failed', 'canceled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state = 'pending' OR refund_id IS NOT NULL)
);

CREATE UNIQUE INDEX stripe_sandbox_one_pending_refund
  ON stripe_sandbox_refund_attempts (payment_attempt_id) WHERE state = 'pending';
CREATE INDEX stripe_sandbox_refunds_by_payment
  ON stripe_sandbox_refund_attempts (payment_attempt_id);

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
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Stripe sandbox payments must be reconciled through Stripe.';
END;
$$;
