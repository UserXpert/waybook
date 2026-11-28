ALTER TABLE stripe_sandbox_checkout_attempts
  ADD COLUMN livemode BOOLEAN NOT NULL DEFAULT FALSE,
  DROP CONSTRAINT stripe_sandbox_checkout_attempts_session_id_check,
  ADD CONSTRAINT stripe_checkout_session_mode
    CHECK (session_id IS NULL
      OR (NOT livemode AND session_id ~ '^cs_test_[A-Za-z0-9]+$')
      OR (livemode AND session_id ~ '^cs_live_[A-Za-z0-9]+$')),
  ADD CONSTRAINT stripe_checkout_live_no_saved_customer
    CHECK (NOT livemode OR stripe_customer_id IS NULL);

CREATE FUNCTION guard_stripe_checkout_livemode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.livemode IS DISTINCT FROM OLD.livemode THEN
    RAISE EXCEPTION 'The Stripe checkout mode cannot change.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER stripe_checkout_livemode_guard
  BEFORE UPDATE OF livemode ON stripe_sandbox_checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_stripe_checkout_livemode();
