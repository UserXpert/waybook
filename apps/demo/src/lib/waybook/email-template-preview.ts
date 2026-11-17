import { substituteEmailPlaceholders, type BookingEmailValues } from "./email-template-render";

/** Preview only: unknown placeholders remain visible for the editor to correct. */
export function previewEmailTemplate(template: string, values: BookingEmailValues): string {
  return substituteEmailPlaceholders(template, values);
}
