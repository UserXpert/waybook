-- A closed/void sale line must remain immutable even when an UPDATE attempts
-- to point it at a different, still-draft sale. Migration 0023 checked the
-- new parent only; this replaces that guard with checks for both parents.

CREATE OR REPLACE FUNCTION prevent_closed_commerce_sale_line_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
    SELECT 1
    FROM commerce_sales
    WHERE id = OLD.sale_id
      AND tenant_id = OLD.tenant_id
      AND status IN ('closed', 'void')
  ) THEN
    RAISE EXCEPTION 'sale lines cannot be changed after a sale is closed or voided';
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
    SELECT 1
    FROM commerce_sales
    WHERE id = NEW.sale_id
      AND tenant_id = NEW.tenant_id
      AND status IN ('closed', 'void')
  ) THEN
    RAISE EXCEPTION 'sale lines cannot be changed after a sale is closed or voided';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
