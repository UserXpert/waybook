/** Provider acceptance is not confirmation of inbox delivery. */
export function emailDeliveryDescription(status: string, result: string | null): string {
  if (status === "sent") return result === "accepted"
    ? "Resend accepted this email. Inbox delivery is not confirmed."
    : "This email was recorded as sent; delivery details are unavailable.";
  if (status === "queued") return result === "retry"
    ? "Delivery could not be confirmed. It will be retried when the delivery worker runs."
    : "This email is queued for delivery when a verified provider and the delivery worker are available.";
  if (result === "review") return "The delivery result needs review. Check Resend before sending again to avoid a duplicate.";
  if (result === "rejected") return "Resend rejected this email. Check the sender and provider account settings.";
  if (result === "retried") return "Resend rejected this attempt. A new attempt was queued separately.";
  if (result === "superseded") return "This email was skipped because it was no longer relevant or was created before the provider was connected.";
  if (result === "invalid_message") return "This email could not be prepared. Check the template and booking details.";
  return "This email could not be sent. Review its details and provider settings.";
}
