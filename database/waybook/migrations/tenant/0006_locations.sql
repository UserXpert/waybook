CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  location_type TEXT NOT NULL DEFAULT 'fixed' CHECK (location_type IN ('fixed', 'mobile')),
  is_online_bookable BOOLEAN NOT NULL DEFAULT TRUE,
  phone TEXT,
  address_line_1 TEXT,
  address_line_2 TEXT,
  city TEXT,
  region TEXT,
  postal_code TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Copenhagen',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE TABLE IF NOT EXISTS location_hours (
  tenant_id UUID NOT NULL,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time CHAR(5) NOT NULL,
  end_time CHAR(5) NOT NULL,
  PRIMARY KEY (location_id, day_of_week),
  CHECK (end_time > start_time)
);

CREATE TABLE IF NOT EXISTS team_member_locations (
  tenant_id UUID NOT NULL,
  team_member_id UUID NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, team_member_id, location_id)
);

CREATE TABLE IF NOT EXISTS service_locations (
  tenant_id UUID NOT NULL,
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, service_id, location_id)
);

ALTER TABLE booking_blocks ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE RESTRICT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id) ON DELETE RESTRICT;

INSERT INTO locations (tenant_id, slug, name, timezone)
SELECT tenant_id, 'primary', name, timezone FROM tenant_settings
ON CONFLICT (tenant_id, slug) DO NOTHING;

INSERT INTO location_hours (tenant_id, location_id, day_of_week, start_time, end_time)
SELECT l.tenant_id, l.id, day.day_of_week, '09:00', '17:00'
FROM locations l CROSS JOIN (VALUES (1::smallint), (2::smallint), (3::smallint), (4::smallint), (5::smallint)) AS day(day_of_week)
WHERE l.slug = 'primary'
ON CONFLICT (location_id, day_of_week) DO NOTHING;

INSERT INTO team_member_locations (tenant_id, team_member_id, location_id)
SELECT tm.tenant_id, tm.id, l.id FROM team_members tm JOIN locations l ON l.tenant_id = tm.tenant_id AND l.slug = 'primary'
ON CONFLICT DO NOTHING;
INSERT INTO service_locations (tenant_id, service_id, location_id)
SELECT s.tenant_id, s.id, l.id FROM services s JOIN locations l ON l.tenant_id = s.tenant_id AND l.slug = 'primary'
ON CONFLICT DO NOTHING;

UPDATE booking_blocks b SET location_id = l.id FROM locations l WHERE l.tenant_id = b.tenant_id AND l.slug = 'primary' AND b.location_id IS NULL;
UPDATE booking_holds h SET location_id = l.id FROM locations l WHERE l.tenant_id = h.tenant_id AND l.slug = 'primary' AND h.location_id IS NULL;
UPDATE bookings b SET location_id = l.id FROM locations l WHERE l.tenant_id = b.tenant_id AND l.slug = 'primary' AND b.location_id IS NULL;
