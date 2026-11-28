import { stripeAppointmentPaymentConfig, stripeLiveWebhookSecret } from "@/lib/waybook/stripe-payment-mode";
import { handleStripePaymentWebhook } from "@/lib/waybook/stripe-payment-webhook-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = stripeAppointmentPaymentConfig(process.env);
  const secret = stripeLiveWebhookSecret(process.env);
  if (config?.livemode !== true || !secret) return new Response(null, { status: 404 });
  return handleStripePaymentWebhook(request, config, secret);
}
