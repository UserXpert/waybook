import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { activeEmailCredential } from "./email-provider-connection";
import { claimEmail, failUnpreparedEmail, finishEmailAttempt, prepareEmailAttempt, type EmailDeliverySnapshot } from "./email-outbox-queue";
import { renderBookingEmail } from "./email-template-render";
import { emailTemplates } from "./email-templates";
import { sendWithResend, type ResendResult } from "./resend-delivery";

type Source = { messageType: string; recipient: string; createdAt: Date; status: string; expectedStartsAt: string | null; customerName: string; serviceName: string; startsAt: Date; bookingNumber: string; businessName: string; timezone: string; subject: string | null; body: string | null };
type Send = typeof sendWithResend;

/** Process one message. Scheduling, authorization, and key management remain the caller's responsibility. */
export async function deliverOneEmail(db: Sql, tenantId: string, resolveKey: (id: string) => Buffer | undefined, send: Send = sendWithResend, outboxId?: string): Promise<"not_configured" | "empty" | "processed" | "lost_claim"> {
  const [connection] = await db.unsafe<Array<{ id: string; sender: string; createdAt: Date }>>(`SELECT id,sender_email AS sender,created_at AS "createdAt" FROM email_provider_connections WHERE tenant_id=$1 AND provider='resend' AND revoked_at IS NULL AND verified_at IS NOT NULL`, [tenantId]);
  if (!connection) return "not_configured";
  const token = randomUUID();
  const claim = await claimEmail(db, tenantId, token, outboxId);
  if (!claim) return "empty";
  let snapshot: EmailDeliverySnapshot;
  if (claim.snapshot) {
    snapshot = claim.snapshot;
  } else {
    const [source] = await db.unsafe<Source[]>(`SELECT eo.message_type AS "messageType",eo.recipient,eo.created_at AS "createdAt",eo.payload->>'startsAt' AS "expectedStartsAt",b.status,c.name AS "customerName",s.title AS "serviceName",b.starts_at AS "startsAt",b.booking_number AS "bookingNumber",ts.name AS "businessName",ts.timezone,et.subject,et.body
      FROM email_outbox eo JOIN bookings b ON b.id=eo.booking_id AND b.tenant_id=eo.tenant_id
      JOIN customers c ON c.id=b.customer_id AND c.tenant_id=b.tenant_id JOIN services s ON s.id=b.service_id AND s.tenant_id=b.tenant_id
      JOIN tenant_settings ts ON ts.tenant_id=eo.tenant_id LEFT JOIN email_templates et ON et.tenant_id=eo.tenant_id AND et.template_key=eo.message_type
      WHERE eo.tenant_id=$1 AND eo.id=$2 AND eo.delivery_claim_token=$3`, [tenantId, claim.id, token]);
    if (!source || !["confirmation", "cancellation", "reminder"].includes(source.messageType)) {
      await failUnpreparedEmail(db, tenantId, claim.id, token, "invalid_message"); return "processed";
    }
    // Connecting an account must not unexpectedly send a historic backlog.
    if (source.createdAt < connection.createdAt || ((source.messageType === "confirmation" || source.messageType === "reminder") && (source.status === "cancelled" || (source.expectedStartsAt && source.expectedStartsAt !== new Date(source.startsAt).toISOString()))) || (source.messageType === "reminder" && (source.status !== "confirmed" || new Date(source.startsAt).getTime() <= Date.now()))) {
      await failUnpreparedEmail(db, tenantId, claim.id, token, "superseded"); return "processed";
    }
    const template = emailTemplates.find((item) => item.key === source.messageType)!;
    try {
      const rendered = renderBookingEmail(source.subject ?? template.subject, source.body ?? template.body, {
        customer_name: source.customerName, business_name: source.businessName, service_name: source.serviceName,
        appointment_date: new Intl.DateTimeFormat("en-GB", { timeZone: source.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(source.startsAt)), booking_number: source.bookingNumber,
      });
      snapshot = { provider: "resend", connectionId: connection.id, bookingStartsAt: new Date(source.startsAt).toISOString(), message: { from: connection.sender, to: source.recipient, subject: rendered.subject, text: rendered.text } };
    } catch {
      await failUnpreparedEmail(db, tenantId, claim.id, token, "invalid_message"); return "processed";
    }
  }
  const prepared = await prepareEmailAttempt(db, tenantId, claim.id, token, snapshot);
  if (!prepared) return "lost_claim";
  let result: ResendResult;
  try {
    const [current] = await db.unsafe<Array<{ messageType: string; status: string; startsAt: Date; remindersEnabled: boolean }>>(`SELECT eo.message_type AS "messageType",b.status,b.starts_at AS "startsAt",coalesce((SELECT enabled FROM email_reminder_settings WHERE tenant_id=eo.tenant_id),false) AS "remindersEnabled" FROM email_outbox eo JOIN bookings b ON b.id=eo.booking_id AND b.tenant_id=eo.tenant_id WHERE eo.tenant_id=$1 AND eo.id=$2`, [tenantId, claim.id]);
    const credential = await activeEmailCredential(db, tenantId, prepared.snapshot.connectionId, resolveKey);
    // A replaced account or cancelled booking must not silently replay an uncertain request.
    if (!current || ((current.messageType === "confirmation" || current.messageType === "reminder") && (current.status === "cancelled" || !prepared.snapshot.bookingStartsAt || new Date(current.startsAt).toISOString() !== prepared.snapshot.bookingStartsAt)) || (current.messageType === "reminder" && (!current.remindersEnabled || current.status !== "confirmed" || new Date(current.startsAt).getTime() <= Date.now())) || !credential || credential.senderEmail !== prepared.snapshot.message.from) result = { kind: "review" };
    else result = await send({ apiKey: credential.apiKey, idempotencyKey: `waybook-email/${claim.id}`, firstAttemptAt: prepared.firstAttemptAt, message: prepared.snapshot.message });
  } catch {
    result = { kind: "review" };
  }
  return await finishEmailAttempt(db, tenantId, claim.id, token, result) ? "processed" : "lost_claim";
}
