CREATE TABLE staff_roles (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 60),
  permissions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(permissions) = 'object'),
  PRIMARY KEY (tenant_id, id)
);

CREATE UNIQUE INDEX staff_roles_tenant_name_key ON staff_roles (tenant_id, lower(name));

ALTER TABLE team_members
  ADD COLUMN staff_role_id uuid,
  ADD CONSTRAINT team_members_custom_staff_role CHECK (staff_role_id IS NULL OR role = 'staff'),
  ADD CONSTRAINT team_members_staff_role_fk FOREIGN KEY (tenant_id, staff_role_id) REFERENCES staff_roles (tenant_id, id);

CREATE INDEX team_members_staff_role_idx ON team_members (tenant_id, staff_role_id) WHERE staff_role_id IS NOT NULL;
