ALTER TABLE tenant_settings
  ADD COLUMN business_profile JSONB NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(business_profile) = 'object');
