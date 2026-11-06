import { NextRequest, NextResponse } from "next/server";
import { availableSlots } from "@/lib/waybook/booking";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";
import { isFeatureEnabled } from "@/lib/waybook/features";

export const runtime = "nodejs";

function invalid(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Public availability is scoped exclusively by the rewritten tenant route on the server. */
export async function GET(request: NextRequest) {
  const tenant = await tenantForPublicRequest(request.headers);
  if (!tenant) return invalid("Booking site not found.", 404);
  if (!await isFeatureEnabled(tenant.id, "booking-essentials")) return invalid("Booking is not available.", 404);
  const service = request.nextUrl.searchParams.get("service")?.trim();
  const locationId = request.nextUrl.searchParams.get("location")?.trim() || undefined;
  const start = request.nextUrl.searchParams.get("start");
  const end = request.nextUrl.searchParams.get("end");
  if (!service || !start || !end) return invalid("service, start, and end are required.");
  const startsAt = new Date(start);
  const endsAt = new Date(end);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) return invalid("Use valid ISO timestamps for the time range.");
  try {
    return NextResponse.json({ tenant: { name: tenant.name, timezone: tenant.timezone }, availability: await availableSlots(tenant, service, startsAt, endsAt, { locationId }) });
  } catch (error) {
    return invalid(error instanceof Error ? error.message : "Could not calculate availability.", 422);
  }
}
