-- Staff time is reserved by booking_blocks only. Resource use is an explicit
-- post-booking lifecycle, so a room/equipment shortage never removes a staff
-- appointment from availability.

CREATE TABLE IF NOT EXISTS booking_resource_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  assigned_by_identity_id UUID,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  release_reason TEXT,
  UNIQUE (tenant_id, booking_id)
);
CREATE INDEX IF NOT EXISTS booking_resource_assignments_resource_active_idx
  ON booking_resource_assignments (tenant_id, resource_id, booking_id)
  WHERE released_at IS NULL;

-- Preserve existing assignments before clearing the legacy booking/hold fields.
INSERT INTO booking_resource_assignments (tenant_id, booking_id, resource_id)
SELECT b.tenant_id, b.id, b.resource_id
FROM bookings b
WHERE b.resource_id IS NOT NULL
ON CONFLICT (tenant_id, booking_id) DO NOTHING;

UPDATE booking_blocks SET resource_id=NULL WHERE resource_id IS NOT NULL;
UPDATE bookings SET resource_id=NULL WHERE resource_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_booking_resource_assignment() RETURNS trigger AS $$
DECLARE
  booking_status TEXT;
  booking_service_id UUID;
  booking_location_id UUID;
  starts_at_value TIMESTAMPTZ;
  ends_at_value TIMESTAMPTZ;
  resource_exclusive BOOLEAN;
BEGIN
  IF NEW.released_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT b.status,b.service_id,b.location_id,b.starts_at,b.ends_at
    INTO booking_status,booking_service_id,booking_location_id,starts_at_value,ends_at_value
  FROM bookings b WHERE b.id=NEW.booking_id AND b.tenant_id=NEW.tenant_id FOR UPDATE;
  IF NOT FOUND OR booking_status NOT IN ('confirmed','arrived') THEN
    RAISE EXCEPTION 'resources can only be assigned to confirmed or arrived appointments';
  END IF;
  SELECT r.is_mutually_exclusive INTO resource_exclusive
  FROM resources r
  JOIN resource_locations rl ON rl.tenant_id=r.tenant_id AND rl.resource_id=r.id AND rl.location_id=booking_location_id
  JOIN service_resources sr ON sr.tenant_id=r.tenant_id AND sr.resource_id=r.id AND sr.service_id=booking_service_id
  WHERE r.id=NEW.resource_id AND r.tenant_id=NEW.tenant_id AND r.is_active=TRUE
  FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'resource must be active and compatible with the appointment service and location'; END IF;
  IF resource_exclusive THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.resource_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM booking_resource_assignments a
      JOIN bookings other ON other.id=a.booking_id AND other.tenant_id=a.tenant_id
      WHERE a.tenant_id=NEW.tenant_id AND a.resource_id=NEW.resource_id AND a.released_at IS NULL
        AND a.booking_id<>NEW.booking_id AND other.status IN ('confirmed','arrived')
        AND other.starts_at<ends_at_value AND other.ends_at>starts_at_value
    ) THEN RAISE EXCEPTION 'exclusive resource is already assigned for this appointment time'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_resource_assignments_guard ON booking_resource_assignments;
CREATE TRIGGER booking_resource_assignments_guard
  BEFORE INSERT OR UPDATE OF resource_id, released_at ON booking_resource_assignments
  FOR EACH ROW EXECUTE FUNCTION enforce_booking_resource_assignment();

CREATE OR REPLACE FUNCTION release_resource_assignment_on_booking_cancel() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('cancelled','no_show') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE booking_resource_assignments SET released_at=now(),release_reason=NEW.status
    WHERE tenant_id=NEW.tenant_id AND booking_id=NEW.id AND released_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS booking_resource_assignment_release ON bookings;
CREATE TRIGGER booking_resource_assignment_release
  AFTER UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION release_resource_assignment_on_booking_cancel();

-- Moving a booking keeps its assignment when it remains valid. If the new
-- interval makes an exclusive assignment conflict, release it visibly rather
-- than silently clearing staff time or rejecting the move.
CREATE OR REPLACE FUNCTION reconcile_resource_assignment_on_booking_move() RETURNS trigger AS $$
DECLARE
  assigned_resource UUID;
  resource_exclusive BOOLEAN;
  compatible BOOLEAN;
BEGIN
  SELECT a.resource_id,r.is_mutually_exclusive INTO assigned_resource,resource_exclusive
  FROM booking_resource_assignments a JOIN resources r ON r.id=a.resource_id AND r.tenant_id=a.tenant_id
  WHERE a.tenant_id=NEW.tenant_id AND a.booking_id=NEW.id AND a.released_at IS NULL FOR UPDATE OF a,r;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT EXISTS(SELECT 1 FROM resource_locations rl JOIN service_resources sr ON sr.tenant_id=rl.tenant_id AND sr.resource_id=rl.resource_id
    WHERE rl.tenant_id=NEW.tenant_id AND rl.resource_id=assigned_resource AND rl.location_id=NEW.location_id AND sr.service_id=NEW.service_id) INTO compatible;
  IF resource_exclusive THEN PERFORM pg_advisory_xact_lock(hashtextextended(assigned_resource::text, 0)); END IF;
  IF NOT compatible OR (resource_exclusive AND EXISTS (
    SELECT 1 FROM booking_resource_assignments a JOIN bookings other ON other.id=a.booking_id AND other.tenant_id=a.tenant_id
    WHERE a.tenant_id=NEW.tenant_id AND a.resource_id=assigned_resource AND a.released_at IS NULL AND a.booking_id<>NEW.id
      AND other.status IN ('confirmed','arrived') AND other.starts_at<NEW.ends_at AND other.ends_at>NEW.starts_at
  )) THEN
    UPDATE booking_resource_assignments SET released_at=now(),release_reason=CASE WHEN compatible THEN 'reschedule_conflict' ELSE 'reschedule_incompatible' END
    WHERE tenant_id=NEW.tenant_id AND booking_id=NEW.id AND released_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS booking_resource_assignment_reconcile ON bookings;
CREATE TRIGGER booking_resource_assignment_reconcile
  AFTER UPDATE OF starts_at, ends_at, service_id, location_id ON bookings
  FOR EACH ROW EXECUTE FUNCTION reconcile_resource_assignment_on_booking_move();
