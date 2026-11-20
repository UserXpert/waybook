-- Packages define a fixed number of visits for one or more services. The
-- relation supports multi-service packages even though the first UI creates
-- one service allocation at a time.

CREATE TABLE IF NOT EXISTS commerce_package_service_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  catalog_item_id UUID NOT NULL REFERENCES commerce_catalog_items(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  included_units INTEGER NOT NULL CHECK (included_units > 0),
  expires_after_days INTEGER CHECK (expires_after_days BETWEEN 1 AND 3650),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, catalog_item_id, service_id)
);
CREATE INDEX IF NOT EXISTS commerce_package_service_entitlements_service_idx
  ON commerce_package_service_entitlements (tenant_id, service_id);

ALTER TABLE commerce_entitlement_entries
  ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE RESTRICT;
ALTER TABLE commerce_entitlement_entries
  ADD COLUMN IF NOT EXISTS direction TEXT CHECK (direction IN ('credit', 'debit'));
UPDATE commerce_entitlement_entries
  SET direction = CASE WHEN kind = 'redeem' THEN 'debit' ELSE 'credit' END
  WHERE direction IS NULL;
ALTER TABLE commerce_entitlement_entries
  ALTER COLUMN direction SET NOT NULL;

CREATE OR REPLACE FUNCTION enforce_commerce_package_entitlement() RETURNS trigger AS $$
DECLARE
  package_status TEXT;
  package_tenant_id UUID;
  allowed_units INTEGER;
  balance_units INTEGER;
BEGIN
  IF NEW.package_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id, status INTO package_tenant_id, package_status
  FROM commerce_packages
  WHERE id = NEW.package_id
    AND tenant_id = NEW.tenant_id
  FOR UPDATE;

  IF NOT FOUND OR package_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'package entitlement must belong to a package in the same tenant';
  END IF;
  IF package_status <> 'active' THEN
    RAISE EXCEPTION 'package entitlements require an active package';
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

DROP TRIGGER IF EXISTS commerce_package_entitlements_lifecycle ON commerce_entitlement_entries;
CREATE TRIGGER commerce_package_entitlements_lifecycle
  BEFORE INSERT ON commerce_entitlement_entries
  FOR EACH ROW EXECUTE FUNCTION enforce_commerce_package_entitlement();
