CREATE TABLE IF NOT EXISTS payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  booking_id UUID NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('payment', 'refund')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL CHECK (method IN ('card', 'cash', 'bank_transfer', 'other')),
  notes TEXT,
  recorded_by_identity_id UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payment_records_tenant_recorded_idx
  ON payment_records(tenant_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS payment_records_booking_idx
  ON payment_records(tenant_id, booking_id, recorded_at DESC);

DROP TRIGGER IF EXISTS payment_records_no_update ON payment_records;
DROP TRIGGER IF EXISTS payment_records_no_delete ON payment_records;
CREATE TRIGGER payment_records_no_update BEFORE UPDATE ON payment_records FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
CREATE TRIGGER payment_records_no_delete BEFORE DELETE ON payment_records FOR EACH ROW EXECUTE FUNCTION prevent_tenant_audit_mutation();
