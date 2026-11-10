export type EmailTemplateExample = {
  customer_name: string;
  business_name: string;
  service_name: string;
  appointment_date: string;
  booking_number: string;
};

/** Preview only: unknown placeholders remain visible for the editor to correct. */
export function previewEmailTemplate(template: string, values: EmailTemplateExample): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key as keyof EmailTemplateExample] : match,
  );
}
