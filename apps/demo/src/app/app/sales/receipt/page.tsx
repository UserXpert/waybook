import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PrintReceiptButton } from "@/components/print-receipt-button";
import { getAppointmentSalePayments, getAppointmentSaleProducts } from "@/lib/waybook/appointment-sale-details";
import { getAdditionalAppointmentServices } from "@/lib/waybook/appointment-service-segments";
import { paymentMethodLabels } from "@/lib/waybook/appointment-payment-records";
import { tenantDb } from "@/lib/waybook/database";
import { requirePageFeature } from "@/lib/waybook/features";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";

type ReceiptAppointment = {
  id: string;
  number: string;
  client: string;
  startsAt: Date;
  location: string | null;
  service: string;
  serviceCents: number;
  noShowChargeCents: number;
  totalCents: number;
  packageRedeemed: boolean;
  currency: string;
};

export default async function AppointmentReceipt({ searchParams }: {
  searchParams: Promise<{ sale?: string }>;
}) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requirePageFeature(tenant.id, "booking-essentials");
  const tenantSlug = await currentTenantRouteSlug(tenant.slug);
  if (!(await staffPermissionContext(tenant, membership)).isManager) redirect(tenantPath(tenantSlug, "/app"));
  const { sale: saleId } = await searchParams;
  if (typeof saleId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(saleId)) notFound();

  const db = tenantDb(tenant);
  const [appointment] = await db<ReceiptAppointment[]>`
    SELECT b.id, b.booking_number AS number, c.name AS client, b.starts_at AS "startsAt",
      l.name AS location, s.title AS service, b.booked_price_cents AS "serviceCents",
      b.no_show_charge_cents AS "noShowChargeCents", cart.chargeable_cents::int AS "totalCents",
      cart.package_redeemed AS "packageRedeemed", sale.currency
    FROM commerce_sales sale
    JOIN bookings b ON b.id=sale.booking_id AND b.tenant_id=sale.tenant_id
    JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id
    JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id
    LEFT JOIN locations l ON l.id=b.location_id AND l.tenant_id=b.tenant_id
    CROSS JOIN LATERAL appointment_checkout_amounts(b.tenant_id, b.id) cart
    WHERE sale.tenant_id=${tenant.id} AND sale.id=${saleId} AND b.status='completed'
  `;
  if (!appointment) notFound();

  const context = { db, tenantId: tenant.id };
  const [products, payments, services] = await Promise.all([
    getAppointmentSaleProducts(context, saleId),
    getAppointmentSalePayments(context, appointment.id),
    getAdditionalAppointmentServices(db, tenant.id, appointment.id),
  ]);
  if (!payments.some((item) => item.kind === "payment")) notFound();

  const money = new Intl.NumberFormat("en-DK", { style: "currency", currency: appointment.currency });
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: tenant.timezone });
  const netPaid = payments.reduce((total, item) => total + (item.kind === "payment" ? item.amountCents : -item.amountCents), 0);

  return <main className="appointment-receipt">
    <nav aria-label="Receipt actions">
      <Link href={tenantPath(tenantSlug, `/app/sales?sale=${saleId}`)}>Back to sale</Link>
      <PrintReceiptButton />
    </nav>
    <article aria-labelledby="appointment-receipt-title">
      <header>
        <p>{tenant.name}{appointment.location && appointment.location !== tenant.name ? ` · ${appointment.location}` : ""}</p>
        <h1 id="appointment-receipt-title">Appointment receipt</h1>
        <dl>
          <div><dt>Booking number</dt><dd>{appointment.number}</dd></div>
          <div><dt>Appointment</dt><dd>{date.format(appointment.startsAt)}</dd></div>
          <div><dt>Client</dt><dd>{appointment.client}</dd></div>
        </dl>
      </header>
      <table>
        <caption>Items</caption>
        <thead><tr><th scope="col">Description</th><th scope="col">Amount</th></tr></thead>
        <tbody>
          <tr><td>{appointment.service}</td><td>{money.format(appointment.serviceCents / 100)}</td></tr>
          {services.map((line) => <tr key={line.id}><td>{line.title}</td><td>{money.format(line.priceCents / 100)}</td></tr>)}
          {products.map((line) => <tr key={line.id}><td>{line.title} × {line.quantity}</td><td>{money.format((line.unitPriceCents * line.quantity - line.discountCents) / 100)}</td></tr>)}
          {appointment.noShowChargeCents > 0 ? <tr><td>No-show fee</td><td>{money.format(appointment.noShowChargeCents / 100)}</td></tr> : null}
          {appointment.packageRedeemed ? <tr><td>Package coverage</td><td>{money.format(-appointment.serviceCents / 100)}</td></tr> : null}
        </tbody>
        <tfoot><tr><th scope="row">Checkout total</th><td>{money.format(appointment.totalCents / 100)}</td></tr></tfoot>
      </table>
      <table>
        <caption>Payments and refunds</caption>
        <thead><tr><th scope="col">Transaction</th><th scope="col">Amount</th></tr></thead>
        <tbody>{[...payments].reverse().map((item) => <tr key={item.id}>
          <td>{item.refundReturned ? "Refund returned" : item.adjustment ? "Payment adjustment" : item.kind === "refund" ? "Refund" : "Payment"} · {paymentMethodLabels[item.method] ?? item.method}<small>{date.format(item.recordedAt)}</small></td>
          <td>{money.format((item.kind === "refund" ? -item.amountCents : item.amountCents) / 100)}</td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row">Net payments</th><td>{money.format(netPaid / 100)}</td></tr></tfoot>
      </table>
    </article>
  </main>;
}
