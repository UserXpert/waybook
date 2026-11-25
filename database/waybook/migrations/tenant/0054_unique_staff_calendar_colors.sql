ALTER TABLE team_members ALTER COLUMN calendar_color DROP DEFAULT;

CREATE FUNCTION staff_next_calendar_color(workspace_id uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  candidate text;
  rgb integer;
BEGIN
  FOREACH candidate IN ARRAY ARRAY['#67c7cf','#5fc4cd','#7baaf7','#a78bfa','#db8cb0','#f59e8b','#f0b86e','#84cc98'] LOOP
    IF NOT EXISTS (SELECT 1 FROM team_members WHERE tenant_id = workspace_id AND calendar_color = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;

  -- An odd multiplier permutes the 21-bit range without repeats. Map its
  -- three 7-bit channels into mid-to-light RGB values for calendar cards.
  FOR slot IN 0..2097151 LOOP
    rgb := ((slot::bigint * 1295813 + 519327) % 2097152)::integer;
    candidate := '#' || to_hex(96 + (rgb >> 14)) || to_hex(96 + ((rgb >> 7) & 127)) || to_hex(96 + (rgb & 127));
    IF NOT EXISTS (SELECT 1 FROM team_members WHERE tenant_id = workspace_id AND calendar_color = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;

  RAISE EXCEPTION 'No staff calendar colour is available';
END;
$$;

UPDATE team_members SET calendar_color = lower(calendar_color) WHERE calendar_color <> lower(calendar_color);

-- Keep the earliest assignment of each colour and repair only duplicates.
DO $$
DECLARE
  staff record;
BEGIN
  FOR staff IN
    SELECT id, tenant_id FROM (
      SELECT id, tenant_id, row_number() OVER (PARTITION BY tenant_id, calendar_color ORDER BY created_at, id) AS position
      FROM team_members
    ) ranked WHERE position > 1 ORDER BY tenant_id, id
  LOOP
    UPDATE team_members SET calendar_color = staff_next_calendar_color(staff.tenant_id) WHERE id = staff.id;
  END LOOP;
END;
$$;

CREATE UNIQUE INDEX team_members_tenant_calendar_color_key ON team_members (tenant_id, calendar_color);

CREATE FUNCTION set_staff_calendar_color() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.calendar_color := lower(NEW.calendar_color);
  IF TG_OP = 'UPDATE' AND NEW.tenant_id = OLD.tenant_id AND NEW.calendar_color = OLD.calendar_color THEN
    RETURN NEW;
  END IF;

  -- Serialize colour changes and allocation in each workspace. The unique
  -- index remains authoritative if a writer uses a stricter snapshot.
  PERFORM pg_advisory_xact_lock(hashtextextended('staff-calendar-color:' || NEW.tenant_id::text, 0));
  IF TG_OP = 'INSERT' AND (NEW.calendar_color IS NULL OR EXISTS (
    SELECT 1 FROM team_members WHERE tenant_id = NEW.tenant_id AND calendar_color = NEW.calendar_color
  )) THEN
    NEW.calendar_color := staff_next_calendar_color(NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER team_members_calendar_color
BEFORE INSERT OR UPDATE OF calendar_color, tenant_id ON team_members
FOR EACH ROW EXECUTE FUNCTION set_staff_calendar_color();
