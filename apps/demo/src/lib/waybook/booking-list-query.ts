import type { tenantDb } from "./database";

export type BookingRow = { id: string; bookingNumber: string; serviceId: string; resourceId: string | null; customerPhone: string | null; saleId: string | null; startsAt: Date; endsAt: Date; status: string; source: string; bookedPriceCents: number; paidCents: number; customerName: string; customerEmail: string; serviceTitle: string; teamMemberId: string | null; teamMemberName: string | null; locationId: string | null; locationName: string | null; resourceName: string | null };

type BookingListFilters = { isManager: boolean; teamMemberId: string | null; locationId?: string; status?: string; search: string };

/** Select the matching page before calculating its payment and resource details. */
export function bookingListQuery(db: ReturnType<typeof tenantDb>, tenantId: string, filters: BookingListFilters) {
  const pattern = `%${filters.search}%`;
  return db<BookingRow[]>`
    WITH page AS MATERIALIZED (
      SELECT b.id FROM bookings b
        JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
        JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id
        LEFT JOIN team_members tm ON tm.id=b.team_member_id AND tm.tenant_id=b.tenant_id
      WHERE b.tenant_id = ${tenantId} ${filters.isManager ? db`` : db`AND b.team_member_id = ${filters.teamMemberId}`} ${filters.locationId ? db`AND b.location_id = ${filters.locationId}` : db``} ${filters.status ? db`AND b.status = ${filters.status}` : db``} ${filters.search ? db`AND (c.name ILIKE ${pattern} OR c.email ILIKE ${pattern} OR b.booking_number ILIKE ${pattern} OR s.title ILIKE ${pattern} OR coalesce(tm.name, '') ILIKE ${pattern})` : db``}
      ORDER BY b.starts_at DESC, b.id DESC LIMIT 100
    )
    SELECT b.id, b.booking_number AS "bookingNumber", b.service_id AS "serviceId", bra.resource_id AS "resourceId", c.phone AS "customerPhone", cs.id AS "saleId", b.starts_at AS "startsAt", b.ends_at AS "endsAt", b.status, b.source, b.booked_price_cents AS "bookedPriceCents", coalesce(sum(CASE WHEN pr.kind='payment' THEN pr.amount_cents ELSE -pr.amount_cents END), 0)::int AS "paidCents",
      c.name AS "customerName", c.email AS "customerEmail", s.title AS "serviceTitle", tm.id AS "teamMemberId", tm.name AS "teamMemberName", b.location_id AS "locationId", l.name AS "locationName", r.name AS "resourceName"
    FROM page JOIN bookings b ON b.id=page.id AND b.tenant_id=${tenantId}
      JOIN customers c ON c.id = b.customer_id AND c.tenant_id = b.tenant_id
      JOIN services s ON s.id = b.service_id AND s.tenant_id = b.tenant_id
      LEFT JOIN team_members tm ON tm.id = b.team_member_id AND tm.tenant_id = b.tenant_id
      LEFT JOIN locations l ON l.id = b.location_id AND l.tenant_id = b.tenant_id
      LEFT JOIN booking_resource_assignments bra ON bra.booking_id=b.id AND bra.tenant_id=b.tenant_id AND bra.released_at IS NULL
      LEFT JOIN resources r ON r.id = bra.resource_id AND r.tenant_id = b.tenant_id
      LEFT JOIN commerce_sales cs ON cs.booking_id = b.id AND cs.tenant_id = b.tenant_id
      LEFT JOIN payment_records pr ON pr.booking_id = b.id AND pr.tenant_id = b.tenant_id
    GROUP BY b.id, cs.id, c.id, s.id, tm.id, l.id, r.id, bra.resource_id ORDER BY b.starts_at DESC, b.id DESC
  `;
}
