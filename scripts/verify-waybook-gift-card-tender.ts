import { randomUUID } from "node:crypto";
import postgres from "postgres";

const raw = process.env.WAYBOOK_NORDIC_STUDIO_DATABASE_URL;
if (!raw) throw new Error("WAYBOOK_NORDIC_STUDIO_DATABASE_URL is required");
const url = new URL(raw);
if (!/^\/waybook_(i28|e2e)_/.test(url.pathname)) throw new Error("Gift-card verification requires a disposable test database.");
const db = postgres(raw, { max: 6, ssl: ["localhost", "127.0.0.1"].includes(url.hostname) ? false : "require" });

async function main() {
  const [settings] = await db<{ tenantId: string; currency: string }[]>`SELECT tenant_id AS "tenantId",currency FROM tenant_settings LIMIT 1`;
  const [member] = await db<{ id: string; locationId: string }[]>`SELECT tm.id,tml.location_id AS "locationId" FROM team_members tm JOIN team_member_locations tml ON tml.tenant_id=tm.tenant_id AND tml.team_member_id=tm.id WHERE tm.tenant_id=${settings.tenantId} LIMIT 1`;
  const [service] = await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id=${settings.tenantId} AND slug='studio-session'`;
  const id = randomUUID().replaceAll("-", "");
  const [client] = await db<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email) VALUES (${settings.tenantId},'Gift-card verification',${`verify-${id}@example.invalid`}) RETURNING id`;
  const [other] = await db<{ id: string }[]>`INSERT INTO customers (tenant_id,name,email) VALUES (${settings.tenantId},'Other verification client',${`verify-other-${id}@example.invalid`}) RETURNING id`;
  let slot = 0;
  async function booking(customerId = client.id) {
    const start = new Date(Date.UTC(2031, 0, 1) + (Number.parseInt(id.slice(0, 5), 16) % 10000 + slot++) * 3_600_000);
    const end = new Date(start.getTime() + 3_600_000);
    return db.begin(async tx => {
      const [block] = await tx<{ id: string }[]>`INSERT INTO booking_blocks (tenant_id,team_member_id,location_id,starts_at,ends_at,state) VALUES (${settings.tenantId},${member.id},${member.locationId},${start},${end},'confirmed') RETURNING id`;
      const [b] = await tx<{ id: string }[]>`INSERT INTO bookings (tenant_id,booking_block_id,service_id,team_member_id,location_id,customer_id,starts_at,ends_at,status,source,booked_price_cents) VALUES (${settings.tenantId},${block.id},${service.id},${member.id},${member.locationId},${customerId},${start},${end},'confirmed','tenant',65000) RETURNING id`;
      const [sale] = await tx<{ id: string }[]>`SELECT id FROM commerce_sales WHERE tenant_id=${settings.tenantId} AND booking_id=${b.id}`;
      return { bookingId: b.id, saleId: sale.id };
    });
  }
  async function card(ownerId: string | null = client.id, balance = 10000, currency = settings.currency) {
    return db.begin(async tx => {
      const [c] = await tx<{ id: string }[]>`INSERT INTO commerce_gift_cards (tenant_id,issued_to_customer_id,code_hash,code_hash_version,code_last_four,currency) VALUES (${settings.tenantId},${ownerId},${randomUUID()},2,'TEST',${currency}) RETURNING id`;
      await tx`INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,kind,direction,amount_cents,currency,reason) VALUES (${settings.tenantId},${c.id},'issue','credit',${balance},${currency},'Synthetic verification')`;
      return c.id;
    });
  }
  async function redeem(target: { bookingId: string; saleId: string }, cardId: string, amount: number, transactionAmount = amount) {
    return db.begin(async tx => {
      await tx`SELECT b.id FROM bookings b JOIN commerce_sales cs ON cs.booking_id=b.id AND cs.tenant_id=b.tenant_id WHERE b.id=${target.bookingId} AND cs.id=${target.saleId} AND b.tenant_id=${settings.tenantId} FOR UPDATE OF b,cs`;
      const [entry] = await tx<{ id: string }[]>`INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,sale_id,booking_id,kind,direction,amount_cents,currency,reason) VALUES (${settings.tenantId},${cardId},${target.saleId},${target.bookingId},'redeem','debit',${amount},${settings.currency},'Synthetic redemption') RETURNING id`;
      const [saleTransaction] = await tx<{ id: string }[]>`INSERT INTO commerce_sale_transactions (tenant_id,sale_id,kind,method,amount_cents,currency) VALUES (${settings.tenantId},${target.saleId},'payment','gift_card',${transactionAmount},${settings.currency}) RETURNING id`;
      await tx`INSERT INTO payment_records (tenant_id,booking_id,kind,method,amount_cents,gift_card_entry_id,gift_card_sale_transaction_id) VALUES (${settings.tenantId},${target.bookingId},'payment','gift_card',${amount},${entry.id},${saleTransaction.id})`;
    });
  }
  async function mustFail(label: string, expected: RegExp, fn: () => Promise<unknown>) {
    try { await fn(); } catch (error) { if (!expected.test(String(error))) throw error; console.log(`${label}: rejected`); return; }
    throw new Error(`${label}: unexpectedly succeeded`);
  }
  const first = await booking(); const firstCard = await card();
  await redeem(first, firstCard, 7500);
  await mustFail("duplicate redemption", /booking_gift_card_one_redemption_idx|duplicate key/i, () => redeem(first, firstCard, 100));
  await mustFail("gift-card value refunded as cash", /gift-card value must be refunded/i, () => db`INSERT INTO payment_records (tenant_id,booking_id,kind,method,amount_cents) VALUES (${settings.tenantId},${first.bookingId},'refund','cash',1)`);
  await mustFail("cancellation without card refund", /must refund gift-card tender/i, () => db`UPDATE bookings SET status='cancelled' WHERE tenant_id=${settings.tenantId} AND id=${first.bookingId}`);
  await mustFail("owner reassignment while tender outstanding", /owner cannot change/i, () => db`UPDATE commerce_gift_cards SET issued_to_customer_id=${other.id} WHERE id=${firstCard} AND tenant_id=${settings.tenantId}`);
  const wrongOwner = await booking(); const wrongCard = await card(other.id);
  await mustFail("named owner mismatch", /must match the sale, named owner and currency/i, () => redeem(wrongOwner, wrongCard, 1000));
  const badAmount = await booking(); const badAmountCard = await card();
  await mustFail("unmatched sale transaction", /must match the sale, named owner and currency/i, () => redeem(badAmount, badAmountCard, 1000, 999));
  const wrongCurrency = await booking(); const foreignCard = await card(client.id, 10000, "EUR");
  await mustFail("card currency mismatch", /must match the sale, named owner and currency/i, () => redeem(wrongCurrency, foreignCard, 1000));
  const empty = await booking(); const smallCard = await card(client.id, 1000);
  await mustFail("insufficient balance", /redemption cannot exceed its balance/i, () => redeem(empty, smallCard, 1001));
  await mustFail("unpaired gift-card debit", /must match the sale, named owner and currency/i, () => db.begin(async tx => { await tx`INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,sale_id,booking_id,kind,direction,amount_cents,currency,reason) VALUES (${settings.tenantId},${smallCard},${empty.saleId},${empty.bookingId},'redeem','debit',1,${settings.currency},'Unpaired synthetic debit')`; }));
  await mustFail("booking debit without its sale", /requires its booking sale/i, () => db.begin(async tx => { await tx`INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,booking_id,kind,direction,amount_cents,currency,reason) VALUES (${settings.tenantId},${smallCard},${empty.bookingId},'redeem','debit',1,${settings.currency},'Unpaired synthetic debit')`; }));
  await mustFail("cross-tenant card movement", /card in the same tenant/i, () => db`INSERT INTO commerce_gift_card_entries (tenant_id,gift_card_id,kind,direction,amount_cents,currency,reason) VALUES (${randomUUID()},${smallCard},'redeem','debit',1,${settings.currency},'Cross-tenant synthetic debit')`);
  const a = await booking(); const b = await booking(); const shared = await card(client.id, 10000);
  const results = await Promise.allSettled([redeem(a, shared, 7500), redeem(b, shared, 7500)]);
  if (results.filter(result => result.status === "fulfilled").length !== 1) throw new Error("Concurrent redemption did not yield exactly one winner");
  const [total] = await db<{ balance: number }[]>`SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount_cents ELSE -amount_cents END),0)::int AS balance FROM commerce_gift_card_entries WHERE tenant_id=${settings.tenantId} AND gift_card_id=${shared}`;
  if (total.balance !== 2500) throw new Error("Concurrent redemption left an incorrect balance");
  console.log("concurrent redemption: one winner; balance verified");
  const raced = await booking(); const raceCard = await card();
  const cancelRace = await Promise.allSettled([
    redeem(raced, raceCard, 5000),
    db`UPDATE bookings SET status='cancelled' WHERE tenant_id=${settings.tenantId} AND id=${raced.bookingId}`,
  ]);
  if (cancelRace.filter(result => result.status === "fulfilled").length !== 1) throw new Error("Redemption versus cancellation did not yield exactly one winner");
  console.log("redemption versus cancellation: one winner");
}

main().then(() => db.end()).catch(async error => { console.error(error); await db.end(); process.exitCode = 1; });
