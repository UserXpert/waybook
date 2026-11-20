-- Correctness invariants discovered during the independent Commerce Foundation QA
-- audit. Ledger direction must be explicit; closed sales cannot be edited.

ALTER TABLE commerce_client_wallet_entries
  ADD COLUMN IF NOT EXISTS direction TEXT CHECK (direction IN ('credit', 'debit'));
UPDATE commerce_client_wallet_entries
  SET direction = CASE WHEN kind = 'debit' THEN 'debit' ELSE 'credit' END
  WHERE direction IS NULL;
ALTER TABLE commerce_client_wallet_entries
  ALTER COLUMN direction SET NOT NULL;

ALTER TABLE commerce_gift_card_entries
  ADD COLUMN IF NOT EXISTS direction TEXT CHECK (direction IN ('credit', 'debit'));
UPDATE commerce_gift_card_entries
  SET direction = CASE WHEN kind IN ('redeem', 'void') THEN 'debit' ELSE 'credit' END
  WHERE direction IS NULL;
ALTER TABLE commerce_gift_card_entries
  ALTER COLUMN direction SET NOT NULL;
ALTER TABLE commerce_gift_card_entries
  DROP CONSTRAINT IF EXISTS commerce_gift_card_entries_kind_direction;
ALTER TABLE commerce_gift_card_entries
  ADD CONSTRAINT commerce_gift_card_entries_kind_direction CHECK (
    (kind IN ('issue', 'refund') AND direction = 'credit')
    OR (kind IN ('redeem', 'void') AND direction = 'debit')
    OR kind = 'adjustment'
  );

CREATE OR REPLACE FUNCTION prevent_closed_commerce_sale_line_mutation() RETURNS trigger AS $$
DECLARE
  current_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO current_status FROM commerce_sales WHERE id = OLD.sale_id AND tenant_id = OLD.tenant_id;
  ELSE
    SELECT status INTO current_status FROM commerce_sales WHERE id = NEW.sale_id AND tenant_id = NEW.tenant_id;
  END IF;
  IF current_status IN ('closed', 'void') THEN
    RAISE EXCEPTION 'sale lines cannot be changed after a sale is closed or voided';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS commerce_sale_lines_closed_no_mutation ON commerce_sale_lines;
CREATE TRIGGER commerce_sale_lines_closed_no_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON commerce_sale_lines
  FOR EACH ROW EXECUTE FUNCTION prevent_closed_commerce_sale_line_mutation();

CREATE UNIQUE INDEX IF NOT EXISTS commerce_payment_methods_one_active_default_idx
  ON commerce_payment_method_references (tenant_id, customer_id)
  WHERE is_default = TRUE AND revoked_at IS NULL;
