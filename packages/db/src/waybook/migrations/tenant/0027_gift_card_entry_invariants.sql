-- Gift-card value is a tenant-local, append-only balance. Locking the card
-- serializes entries so concurrent redemption cannot spend the same balance.

CREATE OR REPLACE FUNCTION enforce_commerce_gift_card_entry() RETURNS trigger AS $$
DECLARE
  card_status TEXT;
  card_expires_at TIMESTAMPTZ;
  balance_cents INTEGER;
  refunded_cents INTEGER;
  redeemed_cents INTEGER;
BEGIN
  SELECT status, expires_at INTO card_status, card_expires_at
  FROM commerce_gift_cards
  WHERE id = NEW.gift_card_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'gift-card entry must belong to a card in the same tenant';
  END IF;

  IF card_status <> 'active' OR (card_expires_at IS NOT NULL AND card_expires_at <= now()) THEN
    RAISE EXCEPTION 'entries can only be recorded against an active, unexpired gift card';
  END IF;

  IF NEW.kind = 'issue' THEN
    IF EXISTS (SELECT 1 FROM commerce_gift_card_entries WHERE tenant_id = NEW.tenant_id AND gift_card_id = NEW.gift_card_id) THEN
      RAISE EXCEPTION 'a gift card can only be issued once';
    END IF;
  ELSIF NEW.kind = 'redeem' THEN
    SELECT coalesce(sum(CASE WHEN direction = 'credit' THEN amount_cents WHEN direction = 'debit' THEN -amount_cents ELSE 0 END), 0)::int
    INTO balance_cents
    FROM commerce_gift_card_entries
    WHERE tenant_id = NEW.tenant_id AND gift_card_id = NEW.gift_card_id;
    IF NEW.amount_cents > balance_cents THEN
      RAISE EXCEPTION 'gift-card redemption cannot exceed its balance';
    END IF;
  ELSIF NEW.kind = 'refund' THEN
    SELECT coalesce(sum(amount_cents) FILTER (WHERE kind = 'redeem'), 0)::int,
           coalesce(sum(amount_cents) FILTER (WHERE kind = 'refund'), 0)::int
    INTO redeemed_cents, refunded_cents
    FROM commerce_gift_card_entries
    WHERE tenant_id = NEW.tenant_id AND gift_card_id = NEW.gift_card_id;
    IF refunded_cents + NEW.amount_cents > redeemed_cents THEN
      RAISE EXCEPTION 'gift-card refunds cannot exceed redeemed value';
    END IF;
  ELSE
    RAISE EXCEPTION 'gift-card adjustments and void entries require their own lifecycle workflow';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commerce_gift_card_entries_lifecycle ON commerce_gift_card_entries;
CREATE TRIGGER commerce_gift_card_entries_lifecycle
  BEFORE INSERT ON commerce_gift_card_entries
  FOR EACH ROW EXECUTE FUNCTION enforce_commerce_gift_card_entry();
