CREATE TABLE tenant_terminology (
  tenant_id UUID PRIMARY KEY REFERENCES tenant_settings (tenant_id) ON DELETE CASCADE,
  client_term TEXT NOT NULL DEFAULT 'client' CHECK (client_term IN ('client', 'patient')),
  staff_term TEXT NOT NULL DEFAULT 'staff' CHECK (staff_term IN ('staff', 'practitioner'))
);
