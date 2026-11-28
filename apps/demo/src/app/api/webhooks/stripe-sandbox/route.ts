import { stripeSandboxConfig } from "@/lib/waybook/stripe-connect-api";
import { handleStripePaymentWebhook } from "@/lib/waybook/stripe-payment-webhook-handler";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const config = stripeSandboxConfig(process.env);
  const secret = process.env.WAYBOOK_STRIPE_SANDBOX_WEBHOOK_SECRET?.trim();
  if (!config || !secret || !/^whsec_[A-Za-z0-9]+$/.test(secret)) return new Response(null, { status: 404 });
  return handleStripePaymentWebhook(request, config, secret);
}
