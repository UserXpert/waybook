-- Refunds are append-only, but their aggregate must never exceed the single
-- collected payment. Replacing the lifecycle function keeps this check under
-- the parent-sale lock established by migration 0025.

CREATE OR REPLACE FUNCTION enforce_commerce_sale_transaction_lifecycle() RETURNS trigger AS $$
DECLARE
  sale_status TEXT;
  paid_cents INTEGER;
  refunded_cents INTEGER;
BEGIN
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
  ELSIF NEW.kind = 'refund' THEN
    IF sale_status <> 'closed' THEN
      RAISE EXCEPTION 'a refund can only be recorded for a closed sale';
    END IF;

    SELECT coalesce(sum(amount_cents), 0)::int INTO paid_cents
    FROM commerce_sale_transactions
    WHERE tenant_id = NEW.tenant_id
      AND sale_id = NEW.sale_id
      AND kind = 'payment';

    SELECT coalesce(sum(amount_cents), 0)::int INTO refunded_cents
    FROM commerce_sale_transactions
    WHERE tenant_id = NEW.tenant_id
      AND sale_id = NEW.sale_id
      AND kind = 'refund';

    IF paid_cents = 0 OR refunded_cents + NEW.amount_cents > paid_cents THEN
      RAISE EXCEPTION 'refund total cannot exceed collected payment';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
