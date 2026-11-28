import { stripePaymentKeyMatchesMode, stripePaymentRequest } from "./stripe-checkout-api";
import type { StripePaymentConfig } from "./stripe-payment-mode";

const refundsPath = "/v1/refunds";
const refundIdPattern = /^re_[A-Za-z0-9]+$/;

export type SandboxRefundContext = {
  accountId: string;
  paymentIntentId: string;
  amountCents: number;
};
export type SandboxRefundAttempt = SandboxRefundContext & { id: string };

export type SandboxRefund = {
  id: string;
  state: "pending" | "succeeded" | "failed" | "canceled";
  failureBalanceTransactionId?: string;
};

export function stripeRefund(config: StripePaymentConfig, request: typeof fetch = fetch) {
  const livemode = config.livemode === true;
  const mode = livemode ? "live" : "sandbox";

  async function call(attempt: SandboxRefundContext, refundId?: string, attemptId?: string): Promise<SandboxRefund> {
    if (!stripePaymentKeyMatchesMode(config) ||
        !/^acct_[A-Za-z0-9]+$/.test(attempt.accountId) ||
        !/^pi_[A-Za-z0-9]+$/.test(attempt.paymentIntentId) ||
        (!refundId && !attemptId) ||
        (attemptId !== undefined && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(attemptId)) ||
        !Number.isSafeInteger(attempt.amountCents) || attempt.amountCents < 1 || attempt.amountCents > 10_000_000 ||
        (refundId !== undefined && !refundIdPattern.test(refundId))) {
      throw new Error(`Invalid Stripe ${mode} refund context.`);
    }
    const creating = refundId === undefined && attemptId !== undefined;
    const body = creating ? new URLSearchParams({
      payment_intent: attempt.paymentIntentId,
      amount: String(attempt.amountCents),
      "metadata[waybook_refund_attempt]": attemptId,
    }) : undefined;
    const response = await stripePaymentRequest(config, request, attempt.accountId,
      refundId ? `${refundsPath}/${refundId}` : refundsPath, refundId ? "GET" : "POST", body, creating ? attemptId : undefined);
    if (!response.ok) throw new Error(`Stripe ${mode} refund could not be confirmed.`);
    const refund = await response.json();
    if (refund?.object !== "refund" || typeof refund.id !== "string" || !refundIdPattern.test(refund.id) ||
        (refundId !== undefined && refund.id !== refundId) || (refund.livemode !== undefined && refund.livemode !== livemode) ||
        refund.payment_intent !== attempt.paymentIntentId || refund.amount !== attempt.amountCents ||
        refund.currency !== "dkk" || refund.metadata?.waybook_refund_attempt !== attemptId) {
      throw new Error(`Stripe did not confirm the expected ${mode} refund.`);
    }
    switch (refund.status) {
      case "requires_action":
      case "pending": return { id: refund.id, state: "pending" };
      case "succeeded":
      case "canceled": return { id: refund.id, state: refund.status };
      case "failed": {
        const transaction = refund.failure_balance_transaction;
        if (typeof transaction === "string" && /^txn_[A-Za-z0-9]+$/.test(transaction)) {
          return { id: refund.id, state: "failed", failureBalanceTransactionId: transaction };
        }
        return { id: refund.id, state: "failed" };
      }
      default: throw new Error("Stripe returned an unexpected refund status.");
    }
  }

  return {
    create: (attempt: SandboxRefundAttempt) => call(attempt, undefined, attempt.id),
    retrieve: (attempt: SandboxRefundAttempt, refundId: string) => call(attempt, refundId, attempt.id),
    retrieveDashboard: (context: SandboxRefundContext, refundId: string) => call(context, refundId),
  };
}

export function stripeRefundSandbox(config: Extract<StripePaymentConfig, { livemode?: false }>, request: typeof fetch = fetch) {
  return stripeRefund({ ...config, livemode: false }, request);
}
