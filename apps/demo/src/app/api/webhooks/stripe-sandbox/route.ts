import { appointmentStripeConfig, settleStripeCheckoutNotification } from "@/lib/waybook/stripe-appointment-checkout";
import { readStripeCheckoutNotification, type StripeCheckoutNotification } from "@/lib/waybook/stripe-checkout-webhook";

export const runtime = "nodejs";

const maxBytes = 256 * 1024;

export async function POST(request: Request) {
  const config = appointmentStripeConfig();
  const secret = process.env.WAYBOOK_STRIPE_SANDBOX_WEBHOOK_SECRET?.trim();
  if (!config || !secret || !/^whsec_[A-Za-z0-9]+$/.test(secret)) return new Response(null, { status: 404 });

  const signature = request.headers.get("stripe-signature");
  if (!signature || signature.length > 4096 || !request.body) return new Response(null, { status: 400 });

  let notification: StripeCheckoutNotification | null;
  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
        length += chunk.value.byteLength;
        if (length > maxBytes) {
          await reader.cancel();
          return new Response(null, { status: 413 });
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    notification = readStripeCheckoutNotification(Buffer.concat(chunks, length), signature, secret);
  } catch {
    return new Response(null, { status: 400 });
  }

  if (notification) {
    try {
      await settleStripeCheckoutNotification(config, notification);
    } catch {
      // Stripe retries failed deliveries. Avoid logging the signed body or credentials.
      console.error("Stripe sandbox checkout webhook could not be reconciled.");
      return new Response(null, { status: 503 });
    }
  }
  return new Response(null, { status: 204 });
}
