-- Locations may open in more than one interval per weekday (for example,
-- 09:00–12:00 and 13:00–17:00). Preserve every existing row while replacing
-- the one-row-per-day key with an ordered range key.
ALTER TABLE location_hours DROP CONSTRAINT IF EXISTS location_hours_pkey;

ALTER TABLE location_hours
  ADD CONSTRAINT location_hours_location_day_start_key
  UNIQUE (location_id, day_of_week, start_time);

CREATE INDEX IF NOT EXISTS location_hours_tenant_location_day_idx
  ON location_hours (tenant_id, location_id, day_of_week, start_time);

ALTER TABLE location_hours
  ADD CONSTRAINT location_hours_no_overlapping_ranges
  EXCLUDE USING gist (
    location_id WITH =,
    day_of_week WITH =,
    int4range(
      (substring(start_time FROM 1 FOR 2)::integer * 60 + substring(start_time FROM 4 FOR 2)::integer),
      (substring(end_time FROM 1 FOR 2)::integer * 60 + substring(end_time FROM 4 FOR 2)::integer),
      '[)'
    ) WITH &&
  );
