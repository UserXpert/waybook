"use server";

import { setCalendarDisplay } from "@/lib/waybook/calendar-display-preferences";
import { redirect } from "next/navigation";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";

export async function saveCalendarDisplay(form: FormData) {
  const { tenant } = await requireTenantWorkspace();
  const saved = await setCalendarDisplay(tenant.id, form);
  const slug = await currentTenantRouteSlug(tenant.slug);
  redirect(`${tenantPath(slug, "/app/settings")}?tab=calendar&calendarStatus=${saved ? "saved" : "hours"}`);
}
