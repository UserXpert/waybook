CREATE TABLE IF NOT EXISTS resource_locations (
  tenant_id UUID NOT NULL,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (tenant_id, resource_id, location_id)
);

CREATE INDEX IF NOT EXISTS resource_locations_location_idx
  ON resource_locations(tenant_id, location_id, resource_id);
