CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS waybook_schema_migrations (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Copenhagen',
  currency CHAR(3) NOT NULL DEFAULT 'DKK',
  booking_page JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  identity_id UUID,
  role TEXT NOT NULL CHECK (role IN ('owner', 'manager', 'staff', 'read-only')),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS service_team_members (
  tenant_id UUID NOT NULL,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  team_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, service_id, team_member_id)
);
CREATE TABLE IF NOT EXISTS service_resources (
  tenant_id UUID NOT NULL,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, service_id, resource_id)
);

CREATE TABLE IF NOT EXISTS availability_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  team_member_id UUID REFERENCES team_members(id) ON DELETE CASCADE,
  resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
  rrule TEXT NOT NULL,
  start_time CHAR(5) NOT NULL,
  end_time CHAR(5) NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Copenhagen',
  valid_from TIMESTAMPTZ,
  valid_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((team_member_id IS NOT NULL)::integer + (resource_id IS NOT NULL)::integer = 1)
);

CREATE TABLE IF NOT EXISTS availability_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  team_member_id UUID REFERENCES team_members(id) ON DELETE CASCADE,
  resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  start_time CHAR(5),
  end_time CHAR(5),
  is_unavailable BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((team_member_id IS NOT NULL)::integer + (resource_id IS NOT NULL)::integer = 1)
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS booking_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  team_member_id UUID REFERENCES team_members(id) ON DELETE RESTRICT,
  resource_id UUID REFERENCES resources(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('held', 'confirmed', 'released', 'expired', 'cancelled')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((team_member_id IS NOT NULL)::integer + (resource_id IS NOT NULL)::integer >= 1)
);
ALTER TABLE booking_blocks DROP CONSTRAINT IF EXISTS booking_blocks_member_no_overlap;
ALTER TABLE booking_blocks ADD CONSTRAINT booking_blocks_member_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, team_member_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (state IN ('held', 'confirmed') AND team_member_id IS NOT NULL);
ALTER TABLE booking_blocks DROP CONSTRAINT IF EXISTS booking_blocks_resource_no_overlap;
ALTER TABLE booking_blocks ADD CONSTRAINT booking_blocks_resource_no_overlap
  EXCLUDE USING gist (tenant_id WITH =, resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (state IN ('held', 'confirmed') AND resource_id IS NOT NULL);

CREATE TABLE IF NOT EXISTS booking_holds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_block_id UUID NOT NULL UNIQUE REFERENCES booking_blocks(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_holds_expiry_idx ON booking_holds(tenant_id, expires_at);

CREATE TABLE IF NOT EXISTS bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_block_id UUID NOT NULL UNIQUE REFERENCES booking_blocks(id) ON DELETE RESTRICT,
  hold_id UUID UNIQUE REFERENCES booking_holds(id) ON DELETE SET NULL,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  team_member_id UUID REFERENCES team_members(id) ON DELETE RESTRICT,
  resource_id UUID REFERENCES resources(id) ON DELETE RESTRICT,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
  source TEXT NOT NULL DEFAULT 'public' CHECK (source IN ('public', 'tenant')),
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS bookings_tenant_start_idx ON bookings(tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS bookings_customer_idx ON bookings(tenant_id, customer_id);

CREATE TABLE IF NOT EXISTS booking_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  actor_identity_id UUID,
  event_type TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  actor_identity_id UUID,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  request_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('confirmation', 'cancellation')),
  recipient TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_management_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  action_scope TEXT NOT NULL CHECK (action_scope IN ('view', 'cancel')),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION prevent_tenant_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'tenant audit/event records are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS tenant_audit_events_no_update ON tenant_audit_events;
DROP TRIGGER IF EXISTS tenant_audit_events_no_delete ON tenant_audit_events;
DROP TRIGGER IF EXISTS booking_events_no_update ON booking_events;
DROP TRIGGER IF EXISTS booking_events_no_delete ON booking_events;
CREATE TRIGGER tenant_audit_events_no_update BEFORE UPDATE ON tenant_audit_events FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
CREATE TRIGGER tenant_audit_events_no_delete BEFORE DELETE ON tenant_audit_events FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
CREATE TRIGGER booking_events_no_update BEFORE UPDATE ON booking_events FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
CREATE TRIGGER booking_events_no_delete BEFORE DELETE ON booking_events FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
