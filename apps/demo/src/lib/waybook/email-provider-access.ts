/** Email provider actions, including the controlled onboarding test, are manager-only. */
export function canManageEmailProvider(input: { isManager: boolean }) {
  return input.isManager;
}
