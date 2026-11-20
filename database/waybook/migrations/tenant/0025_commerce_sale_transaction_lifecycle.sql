-- A sale transaction is append-only, but an append must still respect the
-- sale lifecycle. This prevents a future code path from adding a second
-- payment to a closed checkout after the current UI has hidden its controls.

CREATE OR REPLACE FUNCTION enforce_commerce_sale_transaction_lifecycle() RETURNS trigger AS $$
DECLARE
  sale_status TEXT;
BEGIN
  -- Lock the parent so simultaneous payment attempts serialize before either
  -- can inspect prior ledger entries or change the draft to closed.
  SELECT status INTO sale_status
  FROM commerce_sales
  WHERE id = NEW.sale_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale transaction must belong to a sale in the same tenant';
  END IF;

  IF NEW.kind = 'payment' THEN
    IF sale_status <> 'draft' THEN
      RAISE EXCEPTION 'a payment can only be recorded for a draft sale';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM commerce_sale_transactions
      WHERE tenant_id = NEW.tenant_id
        AND sale_id = NEW.sale_id
        AND kind = 'payment'
    ) THEN
      RAISE EXCEPTION 'a sale can only have one payment';
    END IF;
  ELSIF NEW.kind = 'refund' AND sale_status <> 'closed' THEN
    RAISE EXCEPTION 'a refund can only be recorded for a closed sale';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commerce_sale_transactions_lifecycle ON commerce_sale_transactions;
CREATE TRIGGER commerce_sale_transactions_lifecycle
  BEFORE INSERT ON commerce_sale_transactions
  FOR EACH ROW EXECUTE FUNCTION enforce_commerce_sale_transaction_lifecycle();
