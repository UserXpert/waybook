import type { StripeSandboxConfig } from "./stripe-connect-api";

const refundsUrl = "https://api.stripe.com/v1/refunds";
const refundIdPattern = /^re_[A-Za-z0-9]+$/;

export type SandboxRefundAttempt = {
  id: string;
  accountId: string;
  paymentIntentId: string;
  amountCents: number;
};

export type SandboxRefund = { id: string; state: "pending" | "succeeded" | "failed" | "canceled" };

export function stripeRefundSandbox(config: StripeSandboxConfig, request: typeof fetch = fetch) {
  async function call(attempt: SandboxRefundAttempt, refundId?: string): Promise<SandboxRefund> {
    if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(config.secretKey) ||
        !/^acct_[A-Za-z0-9]+$/.test(attempt.accountId) ||
        !/^pi_[A-Za-z0-9]+$/.test(attempt.paymentIntentId) ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(attempt.id) ||
        !Number.isSafeInteger(attempt.amountCents) || attempt.amountCents < 1 || attempt.amountCents > 10_000_000 ||
        (refundId !== undefined && !refundIdPattern.test(refundId))) {
      throw new Error("Invalid Stripe sandbox refund context.");
    }
    const response = await request(refundId ? `${refundsUrl}/${refundId}` : refundsUrl, {
      method: refundId ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        "Stripe-Version": "2026-11-18.endive",
        "Stripe-Account": attempt.accountId,
        ...(refundId ? {} : { "Idempotency-Key": attempt.id }),
      },
      body: refundId ? undefined : new URLSearchParams({
        payment_intent: attempt.paymentIntentId,
        amount: String(attempt.amountCents),
        "metadata[waybook_refund_attempt]": attempt.id,
      }),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("Stripe sandbox refund could not be confirmed.");
    const refund = await response.json();
    if (refund?.object !== "refund" || typeof refund.id !== "string" || !refundIdPattern.test(refund.id) ||
        (refundId !== undefined && refund.id !== refundId) || (refund.livemode !== undefined && refund.livemode !== false) ||
        refund.payment_intent !== attempt.paymentIntentId || refund.amount !== attempt.amountCents ||
        refund.currency !== "dkk" || refund.metadata?.waybook_refund_attempt !== attempt.id) {
      throw new Error("Stripe did not confirm the expected sandbox refund.");
    }
    switch (refund.status) {
      case "requires_action":
      case "pending": return { id: refund.id, state: "pending" };
      case "succeeded":
      case "failed":
      case "canceled": return { id: refund.id, state: refund.status };
      default: throw new Error("Stripe returned an unexpected refund status.");
    }
  }

  return {
    create: (attempt: SandboxRefundAttempt) => call(attempt),
    retrieve: (attempt: SandboxRefundAttempt, refundId: string) => call(attempt, refundId),
  };
}
