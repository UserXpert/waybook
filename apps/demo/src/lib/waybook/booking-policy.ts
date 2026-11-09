export function requiresPolicyAgreement(policy: { policyVersion?: unknown; policyUrl?: unknown; policyText?: unknown }): boolean {
  return typeof policy.policyVersion === "string" && Boolean(policy.policyVersion.trim()) && ((typeof policy.policyUrl === "string" && Boolean(policy.policyUrl.trim())) || (typeof policy.policyText === "string" && Boolean(policy.policyText.trim())));
}
