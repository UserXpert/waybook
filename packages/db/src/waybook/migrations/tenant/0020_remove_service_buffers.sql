-- Waybook reserves exactly the customer-facing appointment interval. Buffers
-- are not a tenant feature: they created phantom unavailable calendar cells
-- around otherwise valid appointment times. Retain the legacy columns for
-- backwards-compatible schema reads, but clear all values so no runtime or
-- future service record can express buffer-based capacity.
UPDATE services
SET buffer_before_minutes = 0,
    buffer_after_minutes = 0
WHERE buffer_before_minutes <> 0
   OR buffer_after_minutes <> 0;
