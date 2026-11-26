export const businessProfileFields = [
  { key: "legalName", label: "Legal business name", type: "text", maxLength: 160, autoComplete: "organization" },
  { key: "taxNumber", label: "Tax / VAT number", type: "text", maxLength: 64, autoComplete: "off" },
  { key: "email", label: "Business email", type: "email", maxLength: 254, autoComplete: "email" },
  { key: "phone", label: "Business phone", type: "tel", maxLength: 48, autoComplete: "tel" },
  { key: "website", label: "Website", type: "url", maxLength: 500, autoComplete: "url" },
  { key: "addressLine1", label: "Street address", type: "text", maxLength: 160, autoComplete: "address-line1" },
  { key: "addressLine2", label: "Address line 2", type: "text", maxLength: 160, autoComplete: "address-line2" },
  { key: "city", label: "City", type: "text", maxLength: 100, autoComplete: "address-level2" },
  { key: "region", label: "State / region", type: "text", maxLength: 100, autoComplete: "address-level1" },
  { key: "postalCode", label: "Postal code", type: "text", maxLength: 32, autoComplete: "postal-code" },
  { key: "country", label: "Country", type: "text", maxLength: 100, autoComplete: "country-name" },
] as const;

type BusinessProfileKey = (typeof businessProfileFields)[number]["key"];
export type BusinessProfile = Partial<Record<BusinessProfileKey, string>>;

export function parseBusinessProfile(value: unknown): BusinessProfile {
  const profile: BusinessProfile = {};
  if (!value || typeof value !== "object") return profile;
  for (const { key } of businessProfileFields) {
    const field = (value as Record<string, unknown>)[key];
    if (typeof field === "string") profile[key] = field;
  }
  return profile;
}
