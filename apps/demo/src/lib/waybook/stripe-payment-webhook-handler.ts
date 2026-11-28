import { settleStripeCheckoutNotification } from "./stripe-appointment-checkout";
import { settleStripeRefundNotification } from "./stripe-appointment-refunds";
import type { StripePaymentConfig } from "./stripe-payment-mode";
import { readStripePaymentNotification, type StripePaymentNotification } from "./stripe-sandbox-webhook";

const maxBytes = 256 * 1024;

export async function handleStripePaymentWebhook(
  request: Request,
  config: StripePaymentConfig,
  secret: string,
) {
  const signature = request.headers.get("stripe-signature");
  if (!signature || signature.length > 4096 || !request.body) return new Response(null, { status: 400 });

  let notification: StripePaymentNotification | null;
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
    notification = readStripePaymentNotification(Buffer.concat(chunks, length), signature, secret, config.livemode === true);
  } catch {
    return new Response(null, { status: 400 });
  }

  if (notification) {
    try {
      if (notification.kind === "checkout") await settleStripeCheckoutNotification(config, notification);
      else await settleStripeRefundNotification(config, notification);
    } catch {
      // Stripe retries failed deliveries. Avoid logging the signed body or credentials.
      console.error("Stripe payment webhook could not be reconciled.", { kind: notification.kind, livemode: config.livemode === true });
      return new Response(null, { status: 503 });
    }
  }
  return new Response(null, { status: 204 });
}
