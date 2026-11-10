/** Compare the browser's Origin with the actual Host, not the server bind address. */
export function hasMatchingRequestOrigin(origin: string | null, host: string | null, protocol: string): boolean {
  if (!origin || !host || /[\s/@?#\\]/.test(host) || !["http:", "https:"].includes(protocol)) return false;
  try {
    const expected = new URL(`${protocol}//${host}`);
    const supplied = new URL(origin);
    return !expected.username && !expected.password && supplied.origin === expected.origin && origin === supplied.origin;
  } catch {
    return false;
  }
}
