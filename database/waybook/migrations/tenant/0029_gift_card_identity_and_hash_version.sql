-- Existing cards keep their legacy digest version because their raw bearer
-- number is deliberately unrecoverable. New cards use version 2 (HMAC).

ALTER TABLE commerce_gift_cards
  ADD COLUMN IF NOT EXISTS code_hash_version SMALLINT NOT NULL DEFAULT 1
  CHECK (code_hash_version IN (1, 2));

CREATE OR REPLACE FUNCTION prevent_issued_gift_card_identity_mutation() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM commerce_gift_card_entries
    WHERE tenant_id = OLD.tenant_id
      AND gift_card_id = OLD.id
  ) AND (
    NEW.code_hash IS DISTINCT FROM OLD.code_hash
    OR NEW.code_last_four IS DISTINCT FROM OLD.code_last_four
    OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.code_hash_version IS DISTINCT FROM OLD.code_hash_version
  ) THEN
    RAISE EXCEPTION 'an issued gift card cannot change its number or currency';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commerce_gift_cards_identity_immutable ON commerce_gift_cards;
CREATE TRIGGER commerce_gift_cards_identity_immutable
  BEFORE UPDATE ON commerce_gift_cards
  FOR EACH ROW EXECUTE FUNCTION prevent_issued_gift_card_identity_mutation();
