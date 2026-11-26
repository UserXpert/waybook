/** Page clients before aggregating their booking history. All joins remain tenant-scoped. */
export const clientLookupQuery = `WITH page AS MATERIALIZED (
  SELECT id FROM customers WHERE tenant_id=$1 AND ($2='' OR name ILIKE $3 OR email ILIKE $3 OR coalesce(phone,'') ILIKE $3)
    AND ($4::uuid IS NULL OR (name,id) > (coalesce((SELECT name FROM customers WHERE tenant_id=$1 AND id=$4::uuid),''),$4::uuid))
  ORDER BY name,id LIMIT $5
) SELECT c.id,c.name,c.email,c.phone,count(b.id)::int AS "bookingCount",coalesce(sum(b.booked_price_cents) FILTER (WHERE b.status <> 'cancelled'),0)::int AS "bookedValueCents",max(b.starts_at) FILTER (WHERE b.status NOT IN ('cancelled','no_show') AND b.starts_at < now()) AS "lastBookingAt",min(b.starts_at) FILTER (WHERE b.status IN ('confirmed','arrived') AND b.starts_at >= now()) AS "nextBookingAt" FROM customers c LEFT JOIN bookings b ON b.customer_id=c.id AND b.tenant_id=c.tenant_id JOIN page ON page.id=c.id WHERE c.tenant_id=$1 GROUP BY c.id ORDER BY c.name,c.id`;

// The directory's date column is the next active appointment. Keep people
// without one after the dated rows and use name/id to break ties consistently
// across the server-rendered first page and the directory's continuation API.
export const clientDirectoryAppointment = `LEFT JOIN LATERAL (
  SELECT b.starts_at AS date FROM bookings b
  WHERE b.tenant_id=c.tenant_id AND b.customer_id=c.id
    AND b.status IN ('confirmed','arrived') AND b.starts_at >= now()
  ORDER BY b.starts_at LIMIT 1
) next ON true`;

export const clientDirectoryQuery = `WITH candidates AS MATERIALIZED (
  SELECT c.id,c.name,next.date,
    coalesce(extract(epoch FROM next.date) * CASE WHEN $6='newest' THEN -1 ELSE 1 END, 'Infinity'::numeric) AS sort_date
  FROM customers c ${clientDirectoryAppointment}
  WHERE c.tenant_id=$1 AND ($2='' OR c.name ILIKE $3 OR c.email ILIKE $3 OR coalesce(c.phone,'') ILIKE $3)
    AND ($7::timestamptz IS NULL OR next.date >= $7)
    AND ($8::timestamptz IS NULL OR next.date < $8)
), page AS MATERIALIZED (
  SELECT id,name,date,sort_date FROM candidates
  WHERE $4::uuid IS NULL OR (sort_date,name,id) > (SELECT sort_date,name,id FROM candidates WHERE id=$4)
  ORDER BY sort_date,name,id LIMIT $5
)
SELECT c.id,c.name,c.email,c.phone,c.created_at AS "createdAt",
  count(b.id)::int AS "bookingCount",
  coalesce(sum(b.booked_price_cents) FILTER (WHERE b.status <> 'cancelled'),0)::int AS "bookedValueCents",
  max(b.starts_at) FILTER (WHERE b.status NOT IN ('cancelled','no_show') AND b.starts_at < now()) AS "lastBookingAt",
  page.date AS "nextBookingAt"
FROM page JOIN customers c ON c.id=page.id AND c.tenant_id=$1
  LEFT JOIN bookings b ON b.customer_id=c.id AND b.tenant_id=c.tenant_id
GROUP BY c.id,page.date,page.sort_date ORDER BY page.sort_date,c.name,c.id`;
