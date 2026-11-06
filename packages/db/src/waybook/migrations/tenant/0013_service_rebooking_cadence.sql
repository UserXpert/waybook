ALTER TABLE services
  ADD COLUMN IF NOT EXISTS recommended_rebook_days INTEGER;

ALTER TABLE services
  DROP CONSTRAINT IF EXISTS services_recommended_rebook_days_check;

ALTER TABLE services
  ADD CONSTRAINT services_recommended_rebook_days_check
  CHECK (recommended_rebook_days IS NULL OR recommended_rebook_days BETWEEN 1 AND 730);
