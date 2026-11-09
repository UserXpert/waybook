-- Cohesive tenant-local foundation for retail sales, client value, and service
-- entitlements. It deliberately stores no card PAN, CVC, or processor secret.

CREATE TABLE IF NOT EXISTS commerce_catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('product', 'gift_card', 'membership', 'package')),
  title TEXT NOT NULL,
  description TEXT,
  sku TEXT,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'DKK',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);
CREATE INDEX IF NOT EXISTS commerce_catalog_items_tenant_active_idx
  ON commerce_catalog_items (tenant_id, is_active, kind, title);

CREATE TABLE IF NOT EXISTS commerce_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id) ON DELETE RESTRICT,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed', 'void')),
  currency CHAR(3) NOT NULL DEFAULT 'DKK',
  notes TEXT,
  opened_by_identity_id UUID,
  closed_by_identity_id UUID,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK ((status = 'closed') = (closed_by_identity_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS commerce_sales_one_booking_idx
  ON commerce_sales (tenant_id, booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commerce_sales_tenant_status_created_idx
  ON commerce_sales (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS commerce_sales_customer_idx
  ON commerce_sales (tenant_id, customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_sale_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  sale_id UUID NOT NULL REFERENCES commerce_sales(id) ON DELETE RESTRICT,
  catalog_item_id UUID REFERENCES commerce_catalog_items(id) ON DELETE SET NULL,
  line_kind TEXT NOT NULL CHECK (line_kind IN ('appointment_service', 'product', 'gift_card', 'membership', 'package', 'custom')),
  title_snapshot TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (discount_cents <= unit_price_cents * quantity)
);
CREATE INDEX IF NOT EXISTS commerce_sale_lines_sale_idx
  ON commerce_sale_lines (tenant_id, sale_id, created_at);

CREATE TABLE IF NOT EXISTS commerce_sale_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  sale_id UUID NOT NULL REFERENCES commerce_sales(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('payment', 'refund')),
  method TEXT NOT NULL CHECK (method IN ('card', 'cash', 'bank_transfer', 'other', 'wallet', 'gift_card', 'membership', 'package')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'DKK',
  processor_reference TEXT,
  notes TEXT,
  recorded_by_identity_id UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_sale_transactions_sale_idx
  ON commerce_sale_transactions (tenant_id, sale_id, recorded_at DESC);
DROP TRIGGER IF EXISTS commerce_sale_transactions_no_update ON commerce_sale_transactions;
DROP TRIGGER IF EXISTS commerce_sale_transactions_no_delete ON commerce_sale_transactions;
CREATE TRIGGER commerce_sale_transactions_no_update BEFORE UPDATE ON commerce_sale_transactions FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
CREATE TRIGGER commerce_sale_transactions_no_delete BEFORE DELETE ON commerce_sale_transactions FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();

CREATE TABLE IF NOT EXISTS commerce_client_wallet_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES commerce_sales(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('credit', 'debit', 'adjustment')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'DKK',
  reason TEXT NOT NULL,
  recorded_by_identity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_wallet_customer_idx
  ON commerce_client_wallet_entries (tenant_id, customer_id, created_at DESC);
DROP TRIGGER IF EXISTS commerce_client_wallet_entries_no_update ON commerce_client_wallet_entries;
DROP TRIGGER IF EXISTS commerce_client_wallet_entries_no_delete ON commerce_client_wallet_entries;
CREATE TRIGGER commerce_client_wallet_entries_no_update BEFORE UPDATE ON commerce_client_wallet_entries FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
CREATE TRIGGER commerce_client_wallet_entries_no_delete BEFORE DELETE ON commerce_client_wallet_entries FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();

CREATE TABLE IF NOT EXISTS commerce_gift_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  issued_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  code_hash TEXT NOT NULL,
  code_last_four CHAR(4) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'DKK',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'void', 'expired')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code_hash)
);
CREATE INDEX IF NOT EXISTS commerce_gift_cards_customer_idx
  ON commerce_gift_cards (tenant_id, issued_to_customer_id, created_at DESC);

CREATE TABLE IF NOT EXISTS commerce_gift_card_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  gift_card_id UUID NOT NULL REFERENCES commerce_gift_cards(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES commerce_sales(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'redeem', 'refund', 'adjustment', 'void')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency CHAR(3) NOT NULL DEFAULT 'DKK',
  reason TEXT NOT NULL,
  recorded_by_identity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_gift_card_entries_card_idx
  ON commerce_gift_card_entries (tenant_id, gift_card_id, created_at DESC);
DROP TRIGGER IF EXISTS commerce_gift_card_entries_no_update ON commerce_gift_card_entries;
DROP TRIGGER IF EXISTS commerce_gift_card_entries_no_delete ON commerce_gift_card_entries;
CREATE TRIGGER commerce_gift_card_entries_no_update BEFORE UPDATE ON commerce_gift_card_entries FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
CREATE TRIGGER commerce_gift_card_entries_no_delete BEFORE DELETE ON commerce_gift_card_entries FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();

CREATE TABLE IF NOT EXISTS commerce_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  catalog_item_id UUID NOT NULL REFERENCES commerce_catalog_items(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES commerce_sales(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled', 'expired')),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS commerce_memberships_customer_idx
  ON commerce_memberships (tenant_id, customer_id, status, ends_at);

CREATE TABLE IF NOT EXISTS commerce_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  catalog_item_id UUID NOT NULL REFERENCES commerce_catalog_items(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES commerce_sales(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'exhausted', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commerce_packages_customer_idx
  ON commerce_packages (tenant_id, customer_id, status, expires_at);

CREATE TABLE IF NOT EXISTS commerce_entitlement_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  membership_id UUID REFERENCES commerce_memberships(id) ON DELETE RESTRICT,
  package_id UUID REFERENCES commerce_packages(id) ON DELETE RESTRICT,
  booking_id UUID REFERENCES bookings(id) ON DELETE RESTRICT,
  sale_id UUID REFERENCES commerce_sales(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('grant', 'redeem', 'reverse', 'adjustment')),
  units INTEGER NOT NULL CHECK (units > 0),
  reason TEXT NOT NULL,
  recorded_by_identity_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((membership_id IS NOT NULL)::integer + (package_id IS NOT NULL)::integer = 1)
);
CREATE INDEX IF NOT EXISTS commerce_entitlement_entries_membership_idx
  ON commerce_entitlement_entries (tenant_id, membership_id, created_at DESC) WHERE membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS commerce_entitlement_entries_package_idx
  ON commerce_entitlement_entries (tenant_id, package_id, created_at DESC) WHERE package_id IS NOT NULL;
DROP TRIGGER IF EXISTS commerce_entitlement_entries_no_update ON commerce_entitlement_entries;
DROP TRIGGER IF EXISTS commerce_entitlement_entries_no_delete ON commerce_entitlement_entries;
CREATE TRIGGER commerce_entitlement_entries_no_update BEFORE UPDATE ON commerce_entitlement_entries FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
CREATE TRIGGER commerce_entitlement_entries_no_delete BEFORE DELETE ON commerce_entitlement_entries FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();

CREATE TABLE IF NOT EXISTS commerce_payment_method_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL,
  provider_customer_reference TEXT NOT NULL,
  provider_payment_method_reference TEXT NOT NULL,
  brand TEXT,
  last_four CHAR(4),
  expires_month SMALLINT CHECK (expires_month BETWEEN 1 AND 12),
  expires_year SMALLINT CHECK (expires_year BETWEEN 2000 AND 9999),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (tenant_id, provider, provider_payment_method_reference)
);
CREATE INDEX IF NOT EXISTS commerce_payment_method_references_customer_idx
  ON commerce_payment_method_references (tenant_id, customer_id, revoked_at, is_default DESC);
