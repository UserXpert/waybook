-- Ten random base32 characters provide 50 bits of unpredictable entropy.
CREATE OR REPLACE FUNCTION waybook_booking_number() RETURNS text AS $$
DECLARE
  alphabet CONSTANT text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes bytea := gen_random_bytes(10);
  value text := '';
  i integer;
BEGIN
  FOR i IN 0..9 LOOP
    value := value || substr(alphabet, (get_byte(bytes, i) & 31) + 1, 1);
  END LOOP;
  RETURN value;
END;
$$ LANGUAGE plpgsql VOLATILE;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_number text;
DO $$
DECLARE row_id uuid; candidate text;
BEGIN
  FOR row_id IN SELECT id FROM bookings WHERE booking_number IS NULL LOOP
    LOOP
      candidate := waybook_booking_number();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM bookings WHERE booking_number = candidate);
    END LOOP;
    UPDATE bookings SET booking_number = candidate WHERE id = row_id;
  END LOOP;
END;
$$;
ALTER TABLE bookings ALTER COLUMN booking_number SET DEFAULT waybook_booking_number();
ALTER TABLE bookings ALTER COLUMN booking_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_tenant_booking_number_idx ON bookings (tenant_id, booking_number);
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_booking_number_format;
ALTER TABLE bookings ADD CONSTRAINT bookings_booking_number_format CHECK (booking_number ~ '^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$');
