export const emailTemplates = [
  { key: "booking", name: "Booking notification", description: "For a new booking request", subject: "New booking at {{business_name}}", body: "Hello {{customer_name}},\n\nWe received your booking request for {{service_name}} on {{appointment_date}}.\n\n{{business_name}}" },
  { key: "confirmation", name: "Booking confirmation", description: "For a confirmed appointment", subject: "Your booking is confirmed", body: "Hello {{customer_name}},\n\nYour {{service_name}} appointment is confirmed for {{appointment_date}}.\n\nBooking number: {{booking_number}}\n\n{{business_name}}" },
  { key: "cancellation", name: "Cancellation", description: "For a cancelled appointment", subject: "Your booking has been cancelled", body: "Hello {{customer_name}},\n\nYour {{service_name}} appointment on {{appointment_date}} has been cancelled.\n\n{{business_name}}" },
  { key: "sale", name: "Sale notification", description: "For a completed sale", subject: "Thank you for your purchase", body: "Hello {{customer_name}},\n\nThank you for your purchase from {{business_name}}.\n\n{{business_name}}" },
] as const;
