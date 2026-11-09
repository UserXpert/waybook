-- Corrective invariants for package balances and issued-package identity.
-- Package visits are an append-only credit/debit ledger, not an editable count.

CREATE OR REPLACE FUNCTION enforce_commerce_package_entitlement() RETURNS trigger AS $$
DECLARE
  package_status TEXT;
  package_tenant_id UUID;
  package_expires_at TIMESTAMPTZ;
  allowed_units INTEGER;
  balance_units INTEGER;
BEGIN
  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id, status, expires_at
    INTO package_tenant_id, package_status, package_expires_at
  FROM commerce_packages
  WHERE id = NEW.package_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND OR package_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'package entitlement must belong to a package in the same tenant';
  END IF;
  IF package_status <> 'active' OR (package_expires_at IS NOT NULL AND package_expires_at <= now()) THEN
    RAISE EXCEPTION 'package entitlements require an active, unexpired package';
  END IF;
  IF NEW.service_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM commerce_packages cp
    JOIN commerce_package_service_entitlements definition
      ON definition.catalog_item_id = cp.catalog_item_id
      AND definition.tenant_id = cp.tenant_id
    WHERE cp.id = NEW.package_id
      AND cp.tenant_id = NEW.tenant_id
      AND definition.service_id = NEW.service_id
  ) THEN
    RAISE EXCEPTION 'package entitlement service is not included in this package';
  END IF;

  IF NEW.kind = 'grant' THEN
    IF NEW.direction <> 'credit' THEN
      RAISE EXCEPTION 'package grants must be credits';
    END IF;
    SELECT included_units INTO allowed_units
    FROM commerce_packages cp
    JOIN commerce_package_service_entitlements definition
      ON definition.catalog_item_id = cp.catalog_item_id
      AND definition.tenant_id = cp.tenant_id
    WHERE cp.id = NEW.package_id
      AND cp.tenant_id = NEW.tenant_id
      AND definition.service_id = NEW.service_id;
    IF NEW.units <> allowed_units OR EXISTS (SELECT 1 FROM commerce_entitlement_entries WHERE tenant_id=NEW.tenant_id AND package_id=NEW.package_id AND service_id=NEW.service_id AND kind='grant') THEN
      RAISE EXCEPTION 'a package service can only receive its configured initial grant once';
    END IF;
  ELSIF NEW.kind = 'redeem' THEN
    IF NEW.direction <> 'debit' THEN
      RAISE EXCEPTION 'package redemptions must be debits';
    END IF;
    SELECT coalesce(sum(CASE WHEN direction='credit' THEN units ELSE -units END),0)::int INTO balance_units
    FROM commerce_entitlement_entries
    WHERE tenant_id=NEW.tenant_id AND package_id=NEW.package_id AND service_id=NEW.service_id;
    IF NEW.units > balance_units THEN
      RAISE EXCEPTION 'package redemption cannot exceed remaining visits';
    END IF;
  ELSE
    RAISE EXCEPTION 'package reversals and adjustments require their own lifecycle workflow';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_commerce_package_identity() RETURNS trigger AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.catalog_item_id IS DISTINCT FROM NEW.catalog_item_id
    OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
    OR OLD.sale_id IS DISTINCT FROM NEW.sale_id
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at THEN
    RAISE EXCEPTION 'issued package identity and expiry are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS commerce_packages_identity_immutable ON commerce_packages;
CREATE TRIGGER commerce_packages_identity_immutable
  BEFORE UPDATE ON commerce_packages
  FOR EACH ROW EXECUTE FUNCTION enforce_commerce_package_identity();
