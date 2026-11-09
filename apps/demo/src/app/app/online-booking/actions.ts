"use server";

import { revalidatePath } from "next/cache";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { hasRequiredOnlineLocation } from "@/lib/waybook/online-booking-locations";
import { cataloguePhotoFromForm } from "@/lib/waybook/catalogue-media";

const hexColour = /^#[0-9a-f]{6}$/i;

export async function saveOnlineBookingSettings(formData: FormData) {
  const { tenant, membership } = await requireTenantWorkspace();
  await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership);
  if (!permissions.isManager && !permissions.canManageServiceSettings) throw new Error("You do not have permission to manage online booking.");
  const intro = String(formData.get("intro") ?? "").trim();
  const contact = String(formData.get("contact") ?? "").trim();
  const bookingTheme = formData.get("bookingDark") === "on" ? "dark" : "light";
  const brandColor = String(formData.get("brandColor") ?? "").trim();
  const policyVersion = String(formData.get("policyVersion") ?? "").trim();
  const policyUrl = String(formData.get("policyUrl") ?? "").trim();
  const policyText = String(formData.get("policyText") ?? "").trim();
  const managedLocationIds = formData.getAll("managedLocationIds").map(String);
  const onlineLocationIds = formData.getAll("onlineLocationIds").map(String);
  const embedButtonLabel = String(formData.get("embedButtonLabel") ?? "").trim();
  const embedButtonPosition = String(formData.get("embedButtonPosition") ?? "right").trim();
  const embedPanelOverlayColor = String(formData.get("embedPanelOverlayColor") ?? "").trim();
  const embedPanelTitle = String(formData.get("embedPanelTitle") ?? "").trim();
  const embedPanelCopy = String(formData.get("embedPanelCopy") ?? "").trim();
  const serviceStepTitle = String(formData.get("serviceStepTitle") ?? "").trim();
  const timeStepTitle = String(formData.get("timeStepTitle") ?? "").trim();
  const detailsStepTitle = String(formData.get("detailsStepTitle") ?? "").trim();
  const embedOrigins = String(formData.get("embedOrigins") ?? "").split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
  const visibleServiceIds = formData.getAll("visibleServiceIds").filter((value): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value));
  const validUrl = (value: string) => !value || /^https:\/\/[^\s]+$/i.test(value);
  const validOrigin = (value: string) => { try { const parsed = new URL(value); return parsed.origin === value && (parsed.protocol === "https:" || (parsed.protocol === "http:" && parsed.hostname === "localhost")); } catch { return false; } };
  if (intro.length > 280 || contact.length > 160 || policyVersion.length > 80 || policyText.length > 1000 || embedButtonLabel.length > 48 || embedPanelTitle.length > 100 || embedPanelCopy.length > 280 || serviceStepTitle.length > 64 || timeStepTitle.length > 64 || detailsStepTitle.length > 64 || !["left", "right"].includes(embedButtonPosition) || (brandColor && !hexColour.test(brandColor)) || (embedPanelOverlayColor && !hexColour.test(embedPanelOverlayColor)) || !validUrl(policyUrl) || Boolean(policyVersion) !== Boolean(policyUrl || policyText) || embedOrigins.length > 20 || embedOrigins.some((origin) => !validOrigin(origin))) throw new Error("Use a policy version with its HTTPS link, valid six-digit colours, complete website origins, and concise embed copy.");
  const db = tenantDb(tenant);
  const [current] = await db<{ bookingPage: Record<string, unknown> | string | null }[]>`SELECT booking_page AS "bookingPage" FROM tenant_settings WHERE tenant_id=${tenant.id}`;
  const currentPage = typeof current?.bookingPage === "string" ? (() => { try { return JSON.parse(current.bookingPage) as Record<string, unknown>; } catch { return {}; } })() : current?.bookingPage ?? {};
  const panelUpload = new FormData();
  const panelFile = formData.get("embedPanelImage");
  if (panelFile instanceof File) panelUpload.set("photo", panelFile);
  const embedPanelImageUrl = await cataloguePhotoFromForm(panelUpload, typeof currentPage.embedPanelImageUrl === "string" ? currentPage.embedPanelImageUrl : null);
  const logoUpload = new FormData();
  const embedLogoFile = formData.get("embedLogo");
  const bookingLogoFile = formData.get("bookingLogo");
  const logoFile = embedLogoFile instanceof File && embedLogoFile.size > 0 ? embedLogoFile : bookingLogoFile;
  if (logoFile instanceof File) logoUpload.set("photo", logoFile);
  const logoUrl = await cataloguePhotoFromForm(logoUpload, typeof currentPage.logoUrl === "string" ? currentPage.logoUrl : null);
  const services = await db<{ id: string }[]>`SELECT id FROM services WHERE tenant_id=${tenant.id} AND id = ANY(${visibleServiceIds})`;
  if (services.length !== visibleServiceIds.length) throw new Error("One or more selected services are unavailable.");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (managedLocationIds.some(id => !uuid.test(id)) || new Set(managedLocationIds).size !== managedLocationIds.length || onlineLocationIds.some(id => !managedLocationIds.includes(id)) || new Set(onlineLocationIds).size !== onlineLocationIds.length) throw new Error("One or more locations are invalid.");
  const managedLocations = await db<{ id: string }[]>`SELECT id FROM locations WHERE tenant_id=${tenant.id} AND is_active=TRUE AND id = ANY(${managedLocationIds})`;
  if (managedLocations.length !== managedLocationIds.length) throw new Error("One or more locations are unavailable. Refresh and try again.");
  if (!hasRequiredOnlineLocation(managedLocations.length, onlineLocationIds.length)) throw new Error("Keep at least one active location enabled for online booking.");
  const bookingPage = { intro, contact, bookingTheme, policyText: policyText || undefined, brandColor: brandColor || undefined, logoUrl: logoUrl || undefined, policyVersion: policyVersion || undefined, policyUrl: policyUrl || undefined, embedOrigins, embedButtonLabel: embedButtonLabel || undefined, embedButtonPosition, embedPanelImageUrl: embedPanelImageUrl || undefined, embedPanelOverlayColor: embedPanelOverlayColor || undefined, embedPanelTitle: embedPanelTitle || undefined, embedPanelCopy: embedPanelCopy || undefined, serviceStepTitle: serviceStepTitle || undefined, timeStepTitle: timeStepTitle || undefined, detailsStepTitle: detailsStepTitle || undefined, showPrices: formData.get("showPrices") === "on", visibleServiceIds };
  await db.begin(async transaction => {
    await transaction.unsafe("UPDATE tenant_settings SET booking_page=$1::jsonb, updated_at=now() WHERE tenant_id=$2", [JSON.stringify(bookingPage), tenant.id]);
    await transaction.unsafe("UPDATE locations SET is_online_bookable=(id = ANY($1::uuid[])), updated_at=now() WHERE tenant_id=$2 AND is_active=TRUE AND id = ANY($3::uuid[]) AND is_online_bookable IS DISTINCT FROM (id = ANY($1::uuid[]))", [onlineLocationIds, tenant.id, managedLocationIds]);
    await transaction.unsafe("INSERT INTO tenant_audit_events (tenant_id, action, target_type, target_id, metadata) VALUES ($1, 'online_booking.settings_saved', 'tenant_settings', $2, $3::jsonb)", [tenant.id, tenant.id, JSON.stringify({ showPrices: bookingPage.showPrices, visibleServiceCount: visibleServiceIds.length, onlineLocationCount: onlineLocationIds.length })]);
  });
  revalidatePath("/app/locations");
  revalidatePath("/app/online-booking");
  revalidatePath("/book");
}
