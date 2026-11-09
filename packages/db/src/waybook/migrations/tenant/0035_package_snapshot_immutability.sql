-- Snapshots describe the terms actually issued to a client, so they must not
-- drift if a future package definition is edited.

CREATE OR REPLACE FUNCTION enforce_commerce_package_identity() RETURNS trigger AS $$
BEGIN
  IF OLD.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR OLD.catalog_item_id IS DISTINCT FROM NEW.catalog_item_id
    OR OLD.customer_id IS DISTINCT FROM NEW.customer_id
    OR OLD.sale_id IS DISTINCT FROM NEW.sale_id
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.title_snapshot IS DISTINCT FROM NEW.title_snapshot
    OR OLD.price_cents_snapshot IS DISTINCT FROM NEW.price_cents_snapshot
    OR OLD.currency_snapshot IS DISTINCT FROM NEW.currency_snapshot
    OR OLD.service_title_snapshot IS DISTINCT FROM NEW.service_title_snapshot THEN
    RAISE EXCEPTION 'issued package identity, terms, and expiry are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
