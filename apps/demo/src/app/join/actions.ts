"use server";

import { redirect } from "next/navigation";
import { createWaybookSession } from "@/lib/waybook/auth";
import { findTenantRouteSlug } from "@/lib/waybook/database";
import { redeemStaffEmailInvitation } from "@/lib/waybook/staff-invitations";
import { tenantPath } from "@/lib/waybook/tenant-routes";

type JoinState = { error?: string };

export async function acceptEmailInvitation(_: JoinState, formData: FormData): Promise<JoinState> {
  const token = formData.get("invite");
  const password = formData.get("password");
  if (typeof token !== "string" || typeof password !== "string" || password.length < 12 || password.length > 128) {
    return { error: "Choose a password between 12 and 128 characters." };
  }
  if (password !== formData.get("confirmation")) return { error: "The passwords do not match." };
  const accepted = await redeemStaffEmailInvitation(token, password);
  if (!accepted) return { error: "This invitation is expired, already used, or unavailable. Ask your workspace owner for help." };
  await createWaybookSession(accepted.identityId, false);
  redirect(tenantPath(await findTenantRouteSlug(accepted.tenantId, accepted.tenantSlug)));
}
