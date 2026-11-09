import { NextRequest, NextResponse } from "next/server";
import { BookingConflictError } from "@thebookingkit/server";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { consumeBookingManagementAttempt } from "@/lib/waybook/booking-management-rate-limit";
import { cancelManagedBooking, lookupManagedBooking, managedAvailability, rescheduleManagedBooking } from "@/lib/waybook/booking-management";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });
const bookingReference = /^(?:[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/** Credentials are sent in the request body, never the URL or browser storage. */
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin || !request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({ error: "Invalid request." }, 403);
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return reply({ error: "Request is too large." }, 413);
  const reader = request.body?.getReader();
  if (!reader) return reply({ error: "Invalid request." }, 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 4096) { await reader.cancel(); return reply({ error: "Request is too large." }, 413); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const text = new TextDecoder().decode(bytes);
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return reply({ error: "Invalid request." }, 400); }
  const bookingId = typeof body?.bookingId === "string" ? body.bookingId.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const action = typeof body?.action === "string" ? body.action : "";
  if (!bookingReference.test(bookingId) || email.length > 254 || !email.includes("@") || !["lookup", "availability", "cancel", "reschedule"].includes(action)) return reply({ error: "Enter a valid booking number and email." }, 400);
  const tenant = await tenantForPublicRequest(request.headers);
  if (!tenant || !await isFeatureEnabled(tenant.id, "booking-essentials")) return reply({ error: "Booking site not found." }, 404);
  try {
    if (!await consumeBookingManagementAttempt(tenant, bookingId)) return reply({ error: "Too many attempts. Please try again later." }, 429);
    const credentials = { bookingId, email };
    if (action === "lookup") {
      const booking = await lookupManagedBooking(tenant, credentials);
      return booking ? reply({ booking }) : reply({ error: "We couldn’t find a booking with those details." }, 404);
    }
    if (action === "availability") {
      const start = new Date(typeof body.start === "string" ? body.start : "");
      const end = new Date(typeof body.end === "string" ? body.end : "");
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 4 * 86_400_000 || start.getTime() < Date.now() - 2 * 86_400_000 || end.getTime() > Date.now() + 366 * 86_400_000) return reply({ error: "Choose a valid date." }, 400);
      const availability = await managedAvailability(tenant, credentials, start, end);
      return availability ? reply({ availability }) : reply({ error: "This booking cannot be changed online." }, 409);
    }
    if (action === "cancel") {
      const result = await cancelManagedBooking(tenant, credentials);
      if (result === "cancelled") return reply({ result });
      if (result === "financial") return reply({ error: "Please contact the business to cancel this booking because it has payment or package activity." }, 409);
      return reply({ error: "This booking cannot be cancelled online." }, 409);
    }
    const startsAt = new Date(typeof body.startsAt === "string" ? body.startsAt : "");
    if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() > Date.now() + 366 * 86_400_000) return reply({ error: "Choose a valid time." }, 400);
    const result = await rescheduleManagedBooking(tenant, credentials, startsAt);
    return result === "rescheduled" ? reply({ result }) : reply({ error: "That time is no longer available. Please choose another." }, 409);
  } catch (error) {
    if (error instanceof BookingConflictError) return reply({ error: "That time was just taken. Please choose another." }, 409);
    return reply({ error: "We couldn’t process your request. Please try again later." }, 503);
  }
}
