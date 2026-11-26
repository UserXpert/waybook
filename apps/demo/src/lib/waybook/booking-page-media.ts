export function parseBookingPage<T extends object>(value: T | string | null | undefined): T | Record<string, never> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as T;
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function publicBookingImageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return /^https:\/\/[^\s]+$/i.test(value) || /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)
    ? value
    : undefined;
}
