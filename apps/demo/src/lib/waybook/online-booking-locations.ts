/** An existing set of active locations must retain at least one online choice. */
export function hasRequiredOnlineLocation(activeCount: number, selectedCount: number): boolean {
  return activeCount === 0 || selectedCount > 0;
}
