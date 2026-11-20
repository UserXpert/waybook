-- A card's tenant is its ledger boundary and must never be reassigned.

CREATE OR REPLACE FUNCTION prevent_issued_gift_card_identity_mutation() RETURNS trigger AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'a gift card cannot move between tenants';
  END IF;

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
