ALTER TABLE stripe_sandbox_checkout_attempts
  ADD COLUMN payment_method_type TEXT NOT NULL DEFAULT 'card'
    CHECK (payment_method_type IN ('card', 'mobilepay')),
  ADD CONSTRAINT stripe_sandbox_checkout_saved_customer_card
    CHECK (payment_method_type = 'card' OR stripe_customer_id IS NULL);

CREATE FUNCTION guard_stripe_sandbox_checkout_tender() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.payment_method_type IS DISTINCT FROM OLD.payment_method_type THEN
    RAISE EXCEPTION 'The Stripe checkout payment method cannot change.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stripe_sandbox_checkout_tender_guard
  BEFORE UPDATE OF payment_method_type ON stripe_sandbox_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_stripe_sandbox_checkout_tender();
