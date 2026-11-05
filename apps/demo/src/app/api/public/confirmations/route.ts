import { NextRequest, NextResponse } from "next/server";
import { confirmBookingFromHold } from "@/lib/waybook/booking";
import { findTenantByHostname } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";

export const runtime = "nodejs";

type ConfirmationRequest = { holdId?: unknown; idempotencyKey?: unknown; customer?: { name?: unknown; email?: unknown; phone?: unknown } };

/** Confirmation performs the hold-to-booking transition, audit, token, and local outbox write in one transaction. */
export async function POST(request: NextRequest) {
  const tenant = await findTenantByHostname(request.headers.get("host") ?? "");
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
    const result = await confirmBookingFromHold({ tenant, holdId, idempotencyKey, customer: { name, email, phone } });
    return NextResponse.json({ booking: result.booking, managementToken: result.managementToken, idempotent: result.idempotent }, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not confirm this booking." }, { status: 409 });
  }
}
