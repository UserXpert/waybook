"use server";

import { headers } from "next/headers";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { submitStaffAccessRequest } from "@/lib/waybook/staff-access-requests";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";

type IntakeState = { submitted?: boolean; error?: string };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(formData: FormData, field: string) {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

export async function requestStaffAccess(_: IntakeState, formData: FormData): Promise<IntakeState> {
  const name = text(formData, "name");
  const email = text(formData, "email").toLowerCase();
  const phone = text(formData, "phone");
  if (text(formData, "website")) return { submitted: true };
  if (!name || name.length > 160 || !emailPattern.test(email) || email.length > 254 ||
    phone.length > 40 || !/^[+\d][\d\s().-]*$/.test(phone) || phone.replace(/\D/g, "").length < 6) {
    return { error: "Enter your name, work email and a valid phone number." };
  }

  try {
    const tenant = await tenantForPublicRequest(await headers());
    if (!tenant || !(await isFeatureEnabled(tenant.id, "team"))) {
      return { error: "Staff access requests are unavailable for this workspace." };
    }
    const saved = await submitStaffAccessRequest(tenant, { name, email, phone });
    return saved ? { submitted: true } : { error: "Please try again later or contact your workspace owner." };
  } catch {
    return { error: "We couldn’t save your request. Try again or contact your workspace owner." };
  }
}

export async function joinBusinessWaitlist(_: IntakeState, formData: FormData): Promise<IntakeState> {
  const email = text(formData, "email").toLowerCase();
  const business = text(formData, "business");
  const category = text(formData, "category");
  if (text(formData, "website")) return { submitted: true };
  if (!emailPattern.test(email) || email.length > 254 || !business || business.length > 160 ||
    !category || category.length > 40 || formData.get("consent") !== "on") {
    return { error: "Complete the fields and confirm your consent." };
  }

  try {
    const response = await fetch("https://waybook-website.vercel.app/api/waitlist?lang=en", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, business, category, consent: true }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (response.ok && (await response.json()).ok === true) return { submitted: true };
    return { error: response.status === 400 ? "Check your business details and try again." : "We couldn’t save your signup. Try again shortly." };
  } catch {
    return { error: "We couldn’t save your signup. Try again shortly." };
  }
}
