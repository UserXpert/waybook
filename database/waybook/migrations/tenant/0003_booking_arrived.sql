-- Appointment operations add an in-progress state without weakening the
-- existing tenant and booking-block constraints.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
  CHECK (status IN ('confirmed', 'arrived', 'cancelled', 'completed', 'no_show'));
