-- Catalogue presentation is mutable; issued packages must retain the value and
-- wording that existed when the client received them.

ALTER TABLE commerce_gift_cards
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE commerce_packages
  ADD COLUMN IF NOT EXISTS title_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS price_cents_snapshot INTEGER CHECK (price_cents_snapshot >= 0),
  ADD COLUMN IF NOT EXISTS currency_snapshot CHAR(3),
  ADD COLUMN IF NOT EXISTS service_title_snapshot TEXT;

UPDATE commerce_packages cp
SET title_snapshot = ci.title,
    price_cents_snapshot = ci.price_cents,
    currency_snapshot = ci.currency,
    service_title_snapshot = coalesce((
      SELECT s.title
      FROM commerce_package_service_entitlements pe
      JOIN services s ON s.id=pe.service_id AND s.tenant_id=pe.tenant_id
      WHERE pe.tenant_id=cp.tenant_id AND pe.catalog_item_id=cp.catalog_item_id
      ORDER BY pe.created_at LIMIT 1
    ), 'Service')
FROM commerce_catalog_items ci
WHERE cp.catalog_item_id=ci.id
  AND cp.tenant_id=ci.tenant_id
  AND cp.title_snapshot IS NULL;

ALTER TABLE commerce_packages
  ALTER COLUMN title_snapshot SET NOT NULL,
  ALTER COLUMN price_cents_snapshot SET NOT NULL,
  ALTER COLUMN currency_snapshot SET NOT NULL,
  ALTER COLUMN service_title_snapshot SET NOT NULL;
