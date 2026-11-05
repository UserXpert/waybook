import { NextRequest, NextResponse } from "next/server";
import { BookingConflictError } from "@thebookingkit/server";
import { availableSlots, createBookingHold } from "@/lib/waybook/booking";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";
import { isFeatureEnabled } from "@/lib/waybook/features";

export const runtime = "nodejs";

type HoldRequest = { serviceId?: unknown; startsAt?: unknown; endsAt?: unknown };

export async function POST(request: NextRequest) {
  const tenant = await tenantForPublicRequest(request.headers);
  if (!tenant) return NextResponse.json({ error: "Booking site not found." }, { status: 404 });
  if (!await isFeatureEnabled(tenant.id, "booking-essentials")) return NextResponse.json({ error: "Booking is not available." }, { status: 404 });
  const body = await request.json().catch(() => null) as HoldRequest | null;
  const serviceId = typeof body?.serviceId === "string" ? body.serviceId : "";
  const startsAt = new Date(typeof body?.startsAt === "string" ? body.startsAt : "");
  const endsAt = new Date(typeof body?.endsAt === "string" ? body.endsAt : "");
  if (!serviceId || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return NextResponse.json({ error: "A valid service and ISO appointment interval are required." }, { status: 400 });
  }
  try {
    const providers = await availableSlots(tenant, serviceId, new Date(startsAt.getTime() - 24 * 60 * 60_000), new Date(endsAt.getTime() + 24 * 60 * 60_000));
    const eligibleMembers = providers
      .filter((provider) => provider.slots.some((slot) => new Date(slot.startTime).getTime() === startsAt.getTime() && new Date(slot.endTime).getTime() === endsAt.getTime()))
      .map((provider) => provider.teamMemberId);
    if (!eligibleMembers.length) return NextResponse.json({ error: "That appointment is no longer available." }, { status: 409 });

    // The client never chooses a provider. Revalidate the pooled slot here, then
    // try each eligible employee so a concurrent reservation for one does not hide
    // capacity that another employee can still fulfil.
    for (const teamMemberId of eligibleMembers) {
      try {
        return NextResponse.json(await createBookingHold({ tenant, serviceId, teamMemberId, startsAt, endsAt }), { status: 201 });
      } catch (error) {
        if (!(error instanceof BookingConflictError)) throw error;
      }
    }
    return NextResponse.json({ error: "That appointment has just been taken." }, { status: 409 });
  } catch (error) {
    if (error instanceof BookingConflictError) return NextResponse.json({ error: "That appointment has just been taken." }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reserve that appointment." }, { status: 422 });
  }
}
