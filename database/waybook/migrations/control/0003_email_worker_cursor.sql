-- Starting the next sweep after the previous start prevents a long-running
-- tenant at the front of the list from indefinitely starving later tenants.
CREATE TABLE IF NOT EXISTS email_worker_cursor (
  worker TEXT PRIMARY KEY,
  last_start_tenant_id UUID NOT NULL
);
