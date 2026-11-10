"use client";

import { useState } from "react";
import { previewEmailTemplate } from "@/lib/waybook/email-template-preview";

type Props = {
  templateKey: string;
  name: string;
  subject: string;
  body: string;
  businessName: string;
  saved: boolean;
  save: (data: FormData) => Promise<void>;
};

export function EmailTemplateEditor({ templateKey, name, subject: initialSubject, body: initialBody, businessName, saved, save }: Props) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const example = { customer_name: "Alex Morgan", business_name: businessName, service_name: "Example service", appointment_date: "15 March 2030, 10:00", booking_number: "AB12CD34EF" };
  return <form className="email-template-editor" action={save}>
    <div><h2>{name}</h2><p>Customise the subject and message for this template.</p></div>
    {saved ? <p role="status" className="email-template-editor__success">Template saved.</p> : null}
    <input type="hidden" name="template" value={templateKey} />
    <label>Subject<input name="subject" maxLength={200} required value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
    <label>Message<textarea name="body" maxLength={10000} rows={13} required value={body} onChange={(event) => setBody(event.target.value)} /></label>
    <p className="email-template-editor__hint">Placeholders: {"{{customer_name}}"}, {"{{business_name}}"}, {"{{service_name}}"}, {"{{appointment_date}}"}, {"{{booking_number}}"}. Delivery and placeholder replacement are not connected yet.</p>
    <button type="submit">Save template</button>
    <section className="email-template-preview" aria-label="Example email preview">
      <h3>Example preview</h3><p>Uses example booking details. Nothing is sent.</p>
      <strong>{previewEmailTemplate(subject, example)}</strong>
      <div>{previewEmailTemplate(body, example)}</div>
    </section>
  </form>;
}
