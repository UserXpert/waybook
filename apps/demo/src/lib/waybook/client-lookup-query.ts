/** Page clients before aggregating their booking history. All joins remain tenant-scoped. */
export const clientLookupQuery = `WITH page AS MATERIALIZED (
  SELECT id FROM customers WHERE tenant_id=$1 AND ($2='' OR name ILIKE $3 OR email ILIKE $3 OR coalesce(phone,'') ILIKE $3)
    AND ($4::uuid IS NULL OR (name,id) > (coalesce((SELECT name FROM customers WHERE tenant_id=$1 AND id=$4::uuid),''),$4::uuid))
  ORDER BY name,id LIMIT $5
) SELECT c.id,c.name,c.email,c.phone,c.tags,count(b.id)::int AS "bookingCount",coalesce(sum(b.booked_price_cents) FILTER (WHERE b.status <> 'cancelled'),0)::int AS "bookedValueCents",max(b.starts_at) FILTER (WHERE b.status NOT IN ('cancelled','no_show') AND b.starts_at < now()) AS "lastBookingAt",min(b.starts_at) FILTER (WHERE b.status IN ('confirmed','arrived') AND b.starts_at >= now()) AS "nextBookingAt" FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id AND b.tenant_id=c.tenant_id JOIN page ON page.id=c.id WHERE c.tenant_id=$1 GROUP BY c.id ORDER BY c.name,c.id`;
