-- Booking blocks are the concurrency reservation for an appointment. Older
-- Waybook records included setup/cleanup padding in this table even though the
-- customer-facing booking interval never did. That made neighbouring slots
-- appear open or closed inconsistently and caused drag/drop validation to
-- disagree with the calendar. Confirmed blocks must reserve exactly the
-- matching booking interval; temporary holds remain untouched.
UPDATE booking_blocks AS block
SET starts_at = booking.starts_at,
    ends_at = booking.ends_at
FROM bookings AS booking
WHERE booking.booking_block_id = block.id
  AND booking.tenant_id = block.tenant_id
  AND block.state = 'confirmed'
  AND (block.starts_at <> booking.starts_at OR block.ends_at <> booking.ends_at);
