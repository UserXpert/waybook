export type WaybookToastDetail = { message: string };

export const WAYBOOK_TOAST_EVENT = "waybook:toast";

const redirectToastMessages = {
  "package-saved": "Package saved.", "package-issued": "Package issued.", "product-saved": "Product saved.",
  "gift-card-created": "Gift card created.", "gift-card-saved": "Gift card saved.", "service-saved": "Service saved.",
  "resource-saved": "Resource saved.", "location-saved": "Location saved.", "staff-saved": "Staff member saved.",
  "location-closed-date-saved": "Closed date saved.", "location-closed-date-removed": "Closed date removed.",
  "staff-permissions-saved": "Staff permissions saved.", "sale-product-added": "Product added to sale.",
  "package-redeemed": "Package redeemed.", "gift-card-redeemed": "Gift card redeemed.",
  "retail-created": "Retail checkout created.", "retail-product-added": "Product added to checkout.", "retail-payment-collected": "Payment collected.",
} as const;

/** Announces a successful client-side action in the tenant workspace. */
export function showSuccessToast(message: string): void {
  const trimmedMessage = message.trim();
  if (typeof window === "undefined" || !trimmedMessage) return;

  window.dispatchEvent(new CustomEvent<WaybookToastDetail>(WAYBOOK_TOAST_EVENT, {
    detail: { message: trimmedMessage },
  }));
}

export function clearSuccessToast(): void {
  window.dispatchEvent(new CustomEvent(WAYBOOK_TOAST_EVENT, { detail: null }));
}

/** Adds a fixed post-action toast message to a tenant-local redirect. */
export function withSuccessToast(href: string, message: string): string {
  const token = Object.entries(redirectToastMessages).find(([, candidate]) => candidate === message)?.[0];
  if (!token) throw new Error("Only registered success toast messages can be added to redirects.");
  return `${href}${href.includes("?") ? "&" : "?"}toast=${token}`;
}

export function redirectSuccessToastMessage(token: string | null): string | null {
  if (!token || !Object.prototype.hasOwnProperty.call(redirectToastMessages, token)) return null;
  return redirectToastMessages[token as keyof typeof redirectToastMessages];
}
