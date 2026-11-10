export type BookingEmailValues = {
  customer_name: string;
  business_name: string;
  service_name: string;
  appointment_date: string;
  booking_number: string;
};

const allowed = new Set(["customer_name", "business_name", "service_name", "appointment_date", "booking_number"]);
const placeholder = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function unknownEmailPlaceholders(template: string): string[] {
  return [...new Set([...template.matchAll(placeholder)].map((match) => match[1].trim()).filter((key) => !allowed.has(key)))];
}

export function emailTemplateError(subject: string, body: string): string | null {
  if (!subject.trim() || subject.length > 200 || /[\r\n]/.test(subject)) return "Enter a single-line subject of up to 200 characters.";
  if (!body.trim() || body.length > 10000) return "Enter a message of up to 10,000 characters.";
  const unknown = [...new Set([...unknownEmailPlaceholders(subject), ...unknownEmailPlaceholders(body)])];
  if (unknown.length) return `Unsupported placeholders: ${unknown.map((key) => `{{${key}}}`).join(", ")}.`;
  const remainder = `${subject}\n${body}`.replace(placeholder, "");
  if (remainder.includes("{{") || remainder.includes("}}")) return "Check that each placeholder has matching braces.";
  return null;
}

/** Substitute once: inserted customer data is never interpreted as template syntax. */
export function substituteEmailPlaceholders(template: string, values: BookingEmailValues): string {
  return template.replace(placeholder, (match, raw: string) => {
    const key = raw.trim();
    return allowed.has(key) ? values[key as keyof BookingEmailValues] : match;
  });
}

/** A delivery attempt must not send missing values, unknown fields, or multiline headers. */
export function renderBookingEmail(subject: string, body: string, values: BookingEmailValues): { subject: string; text: string } {
  const unknown = [...unknownEmailPlaceholders(subject), ...unknownEmailPlaceholders(body)];
  if (unknown.length) throw new Error("Email template has unsupported placeholders.");
  for (const match of `${subject}\n${body}`.matchAll(placeholder)) {
    const value = values[match[1].trim() as keyof BookingEmailValues];
    if (typeof value !== "string" || !value.trim()) throw new Error("Email template is missing booking details.");
  }
  const renderedSubject = substituteEmailPlaceholders(subject, values).trim();
  const text = substituteEmailPlaceholders(body, values).trim();
  if (!renderedSubject || !text || /[\r\n]/.test(renderedSubject)) throw new Error("Email template has an invalid subject or message.");
  return { subject: renderedSubject, text };
}
