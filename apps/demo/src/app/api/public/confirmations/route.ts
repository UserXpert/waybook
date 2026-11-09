import { NextRequest, NextResponse } from "next/server";
import { confirmBookingFromHold } from "@/lib/waybook/booking";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { tenantDb } from "@/lib/waybook/database";
import { requiresPolicyAgreement } from "@/lib/waybook/booking-policy";
import { verifyEmbedSource } from "@/lib/waybook/embed-token";

export const runtime = "nodejs";

type ConfirmationRequest = { holdId?: unknown; idempotencyKey?: unknown; acceptedPolicy?: unknown; embedSource?: unknown; embedToken?: unknown; customer?: { name?: unknown; email?: unknown; phone?: unknown } };
type BookingPage = { policyVersion?: unknown; policyUrl?: unknown; policyText?: unknown; embedOrigins?: unknown };

function bookingPage(value: BookingPage | string | null | undefined): BookingPage {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value) as BookingPage; } catch { return {}; }
}

/** Confirmation performs the hold-to-booking transition, audit, token, and local outbox write in one transaction. */
export async function POST(request: NextRequest) {
  const tenant = await tenantForPublicRequest(request.headers);
  if (!tenant) return NextResponse.json({ error: "Booking site not found." }, { status: 404 });
  if (!await isFeatureEnabled(tenant.id, "booking-essentials")) return NextResponse.json({ error: "Booking is not available." }, { status: 404 });
  const body = await request.json().catch(() => null) as ConfirmationRequest | null;
  const holdId = typeof body?.holdId === "string" ? body.holdId : "";
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
  const name = typeof body?.customer?.name === "string" ? body.customer.name : "";
  const email = typeof body?.customer?.email === "string" ? body.customer.email : "";
  const phone = typeof body?.customer?.phone === "string" ? body.customer.phone : null;
  if (!holdId || !idempotencyKey || !name.trim() || !email.includes("@")) {
    return NextResponse.json({ error: "A hold, idempotency key, customer name, and valid email are required." }, { status: 400 });
  }
  try {
    const [settings] = await tenantDb(tenant)<{ bookingPage: BookingPage | string | null }[]>`SELECT booking_page AS "bookingPage" FROM tenant_settings WHERE tenant_id=${tenant.id}`;
    const page = bookingPage(settings?.bookingPage);
    const policyVersion = typeof page.policyVersion === "string" ? page.policyVersion : null;
    const policyUrl = typeof page.policyUrl === "string" ? page.policyUrl : null;
    const policyText = typeof page.policyText === "string" ? page.policyText.trim() : "";
    const embedSource = typeof body?.embedSource === "string" ? body.embedSource : null;
    const embedToken = typeof body?.embedToken === "string" ? body.embedToken : null;
    const embedOrigins = Array.isArray(page.embedOrigins) ? page.embedOrigins.filter((value): value is string => typeof value === "string") : [];
    if (requiresPolicyAgreement(page) && body?.acceptedPolicy !== true) return NextResponse.json({ error: "Accept the current booking policy before confirming." }, { status: 400 });
    if (embedSource && (!embedToken || !embedOrigins.includes(embedSource) || !verifyEmbedSource(tenant.id, embedSource, embedToken))) return NextResponse.json({ error: "This embedded booking session has expired. Please reopen it from the website." }, { status: 400 });
    const result = await confirmBookingFromHold({ tenant, holdId, idempotencyKey, customer: { name, email, phone } });
    if (policyVersion && (policyUrl || policyText) && !result.idempotent) await tenantDb(tenant)`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, 'booking.policy_acknowledged', 'booking', ${result.booking.id}, ${JSON.stringify({ policyVersion, policyUrl, policyText: policyText || undefined })}::jsonb)`;
    if (embedSource && !result.idempotent) await tenantDb(tenant)`INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES (${tenant.id}, 'booking.embed_source_verified', 'booking', ${result.booking.id}, ${JSON.stringify({ source: embedSource })}::jsonb)`;
    return NextResponse.json({ booking: result.booking, managementToken: result.managementToken, idempotent: result.idempotent }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not confirm this booking." }, { status: 409 });
  }
}
