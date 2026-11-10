import { createHash } from "node:crypto";
import { requiresPolicyAgreement } from "./booking-policy";

type Policy = { policyVersion?: unknown; policyUrl?: unknown; policyText?: unknown };

/** Fingerprint the exact policy content used by the public booking form. */
export function bookingPolicyRevision(policy: Policy): string | null {
  if (!requiresPolicyAgreement(policy)) return null;
  const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
  return createHash("sha256").update(JSON.stringify([string(policy.policyVersion), string(policy.policyUrl), string(policy.policyText)])).digest("hex");
}

export function isCurrentBookingPolicy(policy: Policy, displayedRevision: unknown): boolean {
  const current = bookingPolicyRevision(policy);
  return current === null ? displayedRevision == null : displayedRevision === current;
}
