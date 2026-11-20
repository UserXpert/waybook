-- Appointment gift-card payments use the existing appointment ledger. Each
-- entry is paired with exactly one gift-card ledger movement at commit.
ALTER TABLE payment_records DROP CONSTRAINT IF EXISTS payment_records_method_check;
ALTER TABLE payment_records ADD CONSTRAINT payment_records_method_check
  CHECK (method IN ('card', 'cash', 'bank_transfer', 'other', 'gift_card'));
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS gift_card_entry_id UUID REFERENCES commerce_gift_card_entries(id) ON DELETE RESTRICT;
ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS gift_card_sale_transaction_id UUID REFERENCES commerce_sale_transactions(id) ON DELETE RESTRICT;
ALTER TABLE commerce_gift_card_entries ADD COLUMN IF NOT EXISTS booking_id UUID REFERENCES bookings(id) ON DELETE RESTRICT;
ALTER TABLE payment_records DROP CONSTRAINT IF EXISTS payment_records_gift_card_link_check;
ALTER TABLE payment_records ADD CONSTRAINT payment_records_gift_card_link_check
  CHECK ((method = 'gift_card' AND gift_card_entry_id IS NOT NULL AND gift_card_sale_transaction_id IS NOT NULL)
      OR (method <> 'gift_card' AND gift_card_entry_id IS NULL AND gift_card_sale_transaction_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS payment_records_one_gift_card_entry_idx
  ON payment_records (tenant_id, gift_card_entry_id) WHERE gift_card_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_records_one_gift_card_sale_transaction_idx
  ON payment_records (tenant_id, gift_card_sale_transaction_id) WHERE gift_card_sale_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS booking_gift_card_one_redemption_idx
  ON commerce_gift_card_entries (tenant_id, booking_id)
  WHERE kind = 'redeem' AND booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS booking_gift_card_one_refund_idx
  ON commerce_gift_card_entries (tenant_id, booking_id)
  WHERE kind = 'refund' AND booking_id IS NOT NULL;

CREATE OR REPLACE FUNCTION check_booking_gift_card_pair() RETURNS trigger AS $$
DECLARE
  entry_id UUID;
  entry_tenant UUID;
  entry_kind TEXT;
  entry_amount INTEGER;
  entry_currency CHAR(3);
  entry_card UUID;
  entry_sale UUID;
  sale_booking UUID;
  sale_customer UUID;
  sale_currency CHAR(3);
  sale_status TEXT;
  entry_booking UUID;
  card_customer UUID;
  card_currency CHAR(3);
  payment_booking UUID;
  payment_kind TEXT;
  payment_amount INTEGER;
  appointment_status TEXT;
  transaction_sale UUID;
  transaction_tenant UUID;
  transaction_kind TEXT;
  transaction_method TEXT;
  transaction_amount INTEGER;
  transaction_currency CHAR(3);
  payment_transaction UUID;
BEGIN
  IF TG_TABLE_NAME = 'payment_records' THEN
    IF NEW.method <> 'gift_card' THEN RETURN NEW; END IF;
    entry_id := NEW.gift_card_entry_id;
  ELSIF TG_TABLE_NAME = 'commerce_gift_card_entries' THEN
    IF NEW.kind NOT IN ('redeem', 'refund') THEN RETURN NEW; END IF;
    IF NEW.sale_id IS NULL THEN
      IF NEW.booking_id IS NOT NULL THEN RAISE EXCEPTION 'appointment gift-card movement requires its booking sale'; END IF;
      RETURN NEW;
    END IF;
    SELECT booking_id INTO sale_booking FROM commerce_sales WHERE id=NEW.sale_id AND tenant_id=NEW.tenant_id;
    IF sale_booking IS NULL THEN
      IF NEW.booking_id IS NOT NULL THEN RAISE EXCEPTION 'appointment gift-card movement requires its booking sale'; END IF;
      RETURN NEW;
    END IF;
    entry_id := NEW.id;
  ELSE
    SELECT booking_id INTO sale_booking FROM commerce_sales WHERE id=NEW.sale_id AND tenant_id=NEW.tenant_id;
    IF sale_booking IS NULL THEN RETURN NEW; END IF;
    SELECT gift_card_entry_id INTO entry_id FROM payment_records WHERE tenant_id=NEW.tenant_id AND gift_card_sale_transaction_id=NEW.id;
  END IF;
  SELECT ge.tenant_id, ge.kind, ge.amount_cents, ge.currency, ge.gift_card_id, ge.booking_id, ge.sale_id,
         cs.booking_id, cs.customer_id, cs.currency, cs.status,
         gc.issued_to_customer_id, gc.currency
    INTO entry_tenant, entry_kind, entry_amount, entry_currency, entry_card, entry_booking, entry_sale,
         sale_booking, sale_customer, sale_currency, sale_status, card_customer, card_currency
  FROM commerce_gift_card_entries ge
  JOIN commerce_sales cs ON cs.id=ge.sale_id AND cs.tenant_id=ge.tenant_id
  JOIN commerce_gift_cards gc ON gc.id=ge.gift_card_id AND gc.tenant_id=ge.tenant_id
  WHERE ge.id=entry_id;
  SELECT booking_id, kind, amount_cents, gift_card_sale_transaction_id INTO payment_booking, payment_kind, payment_amount, payment_transaction
    FROM payment_records WHERE tenant_id=entry_tenant AND gift_card_entry_id=entry_id AND method='gift_card';
  SELECT tenant_id, sale_id, kind, method, amount_cents, currency
    INTO transaction_tenant, transaction_sale, transaction_kind, transaction_method, transaction_amount, transaction_currency
    FROM commerce_sale_transactions WHERE id=payment_transaction;
  SELECT status INTO appointment_status FROM bookings WHERE id=sale_booking AND tenant_id=entry_tenant;
  IF entry_tenant IS NULL OR sale_booking IS NULL OR entry_booking IS DISTINCT FROM sale_booking OR payment_booking IS DISTINCT FROM sale_booking
     OR payment_kind IS DISTINCT FROM (CASE entry_kind WHEN 'redeem' THEN 'payment' WHEN 'refund' THEN 'refund' END)
     OR payment_amount IS DISTINCT FROM entry_amount OR entry_currency <> sale_currency OR card_currency <> sale_currency
     OR transaction_tenant IS DISTINCT FROM entry_tenant OR transaction_sale IS DISTINCT FROM entry_sale
     OR transaction_kind IS DISTINCT FROM payment_kind OR transaction_method IS DISTINCT FROM 'gift_card'
     OR transaction_amount IS DISTINCT FROM entry_amount OR transaction_currency IS DISTINCT FROM entry_currency
     OR (card_customer IS NOT NULL AND card_customer IS DISTINCT FROM sale_customer) THEN
    RAISE EXCEPTION 'appointment gift-card movement and payment must match the sale, named owner and currency';
  END IF;
  IF entry_kind = 'redeem' AND (sale_status <> 'open' OR appointment_status NOT IN ('confirmed','arrived')) THEN
    RAISE EXCEPTION 'gift-card redemption requires an open sale and active appointment';
  END IF;
  IF entry_kind = 'refund' AND (appointment_status <> 'cancelled' OR NOT EXISTS (
    SELECT 1 FROM commerce_gift_card_entries prior
    WHERE prior.tenant_id=entry_tenant AND prior.sale_id=entry_sale AND prior.booking_id=sale_booking
      AND prior.gift_card_id=entry_card AND prior.kind='redeem'
      AND (SELECT coalesce(sum(r.amount_cents),0) FROM commerce_gift_card_entries r
           WHERE r.tenant_id=prior.tenant_id AND r.sale_id=prior.sale_id AND r.gift_card_id=prior.gift_card_id AND r.kind='refund') <= prior.amount_cents
  )) THEN
    RAISE EXCEPTION 'appointment gift-card refunds must return to the original card';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_gift_card_owner_with_outstanding_tender() RETURNS trigger AS $$
BEGIN
  IF NEW.issued_to_customer_id IS DISTINCT FROM OLD.issued_to_customer_id AND EXISTS (
    SELECT 1 FROM commerce_gift_card_entries e WHERE e.tenant_id=OLD.tenant_id AND e.gift_card_id=OLD.id AND e.booking_id IS NOT NULL
    GROUP BY e.booking_id HAVING sum(CASE WHEN e.kind='redeem' THEN e.amount_cents WHEN e.kind='refund' THEN -e.amount_cents ELSE 0 END)>0
  ) THEN RAISE EXCEPTION 'gift card owner cannot change while an appointment redemption is outstanding'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS gift_card_outstanding_owner_guard ON commerce_gift_cards;
CREATE TRIGGER gift_card_outstanding_owner_guard BEFORE UPDATE OF issued_to_customer_id ON commerce_gift_cards
  FOR EACH ROW EXECUTE FUNCTION guard_gift_card_owner_with_outstanding_tender();

DROP TRIGGER IF EXISTS payment_record_gift_card_pair ON payment_records;
CREATE CONSTRAINT TRIGGER payment_record_gift_card_pair AFTER INSERT ON payment_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_gift_card_pair();
DROP TRIGGER IF EXISTS gift_card_booking_payment_pair ON commerce_gift_card_entries;
CREATE CONSTRAINT TRIGGER gift_card_booking_payment_pair AFTER INSERT ON commerce_gift_card_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_gift_card_pair();
DROP TRIGGER IF EXISTS booking_gift_card_transaction_pair ON commerce_sale_transactions;
CREATE CONSTRAINT TRIGGER booking_gift_card_transaction_pair AFTER INSERT ON commerce_sale_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_booking_gift_card_pair();

CREATE OR REPLACE FUNCTION guard_booking_sale_tender() RETURNS trigger AS $$
DECLARE linked_booking UUID;
BEGIN
  SELECT booking_id INTO linked_booking FROM commerce_sales WHERE tenant_id=NEW.tenant_id AND id=NEW.sale_id FOR UPDATE;
  IF linked_booking IS NOT NULL AND NEW.method <> 'gift_card' THEN
    RAISE EXCEPTION 'booking payments must be recorded in the appointment ledger';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_commerce_sale_transaction_lifecycle() RETURNS trigger AS $$
DECLARE sale_status TEXT; linked_booking UUID; paid_cents INTEGER; refunded_cents INTEGER;
BEGIN
  SELECT status, booking_id INTO sale_status, linked_booking FROM commerce_sales
    WHERE id=NEW.sale_id AND tenant_id=NEW.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'sale transaction must belong to a sale in the same tenant'; END IF;
  IF linked_booking IS NOT NULL THEN
    IF sale_status <> 'open' OR NEW.method <> 'gift_card' THEN RAISE EXCEPTION 'appointment sale transaction must be linked gift-card tender'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.kind='payment' THEN
    IF sale_status <> 'draft' THEN RAISE EXCEPTION 'a payment can only be recorded for a draft sale'; END IF;
    IF EXISTS (SELECT 1 FROM commerce_sale_transactions WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id AND kind='payment') THEN
      RAISE EXCEPTION 'a sale can only have one payment';
    END IF;
  ELSIF NEW.kind='refund' THEN
    IF sale_status <> 'closed' THEN RAISE EXCEPTION 'a refund can only be recorded for a closed sale'; END IF;
    SELECT coalesce(sum(amount_cents) FILTER (WHERE kind='payment'),0)::int,
           coalesce(sum(amount_cents) FILTER (WHERE kind='refund'),0)::int INTO paid_cents, refunded_cents
      FROM commerce_sale_transactions WHERE tenant_id=NEW.tenant_id AND sale_id=NEW.sale_id;
    IF paid_cents=0 OR refunded_cents+NEW.amount_cents>paid_cents THEN RAISE EXCEPTION 'refund total cannot exceed collected payment'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ordinary refunds may only return non-gift tender; card value must return to
-- the same gift card through a linked gift-card refund.
CREATE OR REPLACE FUNCTION guard_booking_refund_tender() RETURNS trigger AS $$
DECLARE available_cents INTEGER;
BEGIN
  IF NEW.kind <> 'refund' OR NEW.method = 'gift_card' THEN RETURN NEW; END IF;
  SELECT coalesce(sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END),0)::int
    INTO available_cents FROM payment_records
    WHERE tenant_id=NEW.tenant_id AND booking_id=NEW.booking_id AND method <> 'gift_card';
  IF NEW.amount_cents > available_cents THEN
    RAISE EXCEPTION 'gift-card value must be refunded to the original gift card';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS booking_refund_tender_guard ON payment_records;
CREATE TRIGGER booking_refund_tender_guard BEFORE INSERT ON payment_records
  FOR EACH ROW EXECUTE FUNCTION guard_booking_refund_tender();

-- A cancelled appointment cannot commit while a gift-card debit remains
-- outstanding. This also protects direct writes and cancellation races.
CREATE OR REPLACE FUNCTION require_gift_card_refund_on_cancellation() RETURNS trigger AS $$
DECLARE outstanding INTEGER;
BEGIN
  IF NEW.status <> 'cancelled' THEN RETURN NEW; END IF;
  SELECT coalesce(sum(CASE WHEN kind='redeem' THEN amount_cents WHEN kind='refund' THEN -amount_cents ELSE 0 END),0)::int
    INTO outstanding FROM commerce_gift_card_entries WHERE tenant_id=NEW.tenant_id AND booking_id=NEW.id;
  IF outstanding <> 0 THEN RAISE EXCEPTION 'cancelled appointments must refund gift-card tender'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS booking_gift_card_refund_on_cancellation ON bookings;
CREATE CONSTRAINT TRIGGER booking_gift_card_refund_on_cancellation AFTER UPDATE OF status ON bookings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION require_gift_card_refund_on_cancellation();
