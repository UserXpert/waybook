import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PublicBookingFlow } from "@/components/public-booking-flow";
import { tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";
import { routeSlugFromHostname } from "@/lib/waybook/tenant-routes";
import { bookingPolicyRevision } from "@/lib/waybook/booking-policy-revision";

export const dynamic = "force-dynamic";

type Service = { id: string; title: string; description: string | null; durationMinutes: number; priceCents: number; locationIds: string[] };
type TeamMember = { id: string; name: string; serviceId: string };
type Location = { id: string; name: string; locationType: string };
type BookingPage = { embedButtonLabel?: unknown; embedButtonPosition?: unknown; bookingTheme?: unknown; intro?: unknown; contact?: unknown; brandColor?: unknown; logoUrl?: unknown; embedPanelImageUrl?: unknown; embedPanelOverlayColor?: unknown; embedPanelTitle?: unknown; embedPanelCopy?: unknown; policyVersion?: unknown; policyUrl?: unknown; policyText?: unknown; serviceStepTitle?: unknown; timeStepTitle?: unknown; detailsStepTitle?: unknown; showPrices?: unknown; visibleServiceIds?: unknown };

function parseBookingPage(value: BookingPage | string | null | undefined): BookingPage {
  if (typeof value !== "string") return value ?? {};
  try { return JSON.parse(value) as BookingPage; } catch { return {}; }
}

/** The tenant is resolved from the trusted same-origin route before any operational data is queried. */
export default async function PublicBookingPage({ searchParams }: { searchParams: Promise<{ location?: string; service?: string; embedSource?: string; embedToken?: string; manage?: string }> }) {
  const requestHeaders = await headers();
  const presets = await searchParams;
  const tenant = await tenantForPublicRequest(requestHeaders);
  if (!tenant) notFound();
  if (!await isFeatureEnabled(tenant.id, "booking-essentials")) notFound();
  const db = tenantDb(tenant);
  const [settings, services, teamMembers, locations] = await Promise.all([
    db<{ name: string; timezone: string; currency: string; bookingPage: BookingPage | string | null }[]>`SELECT name, timezone, currency, booking_page AS "bookingPage" FROM tenant_settings WHERE tenant_id = ${tenant.id} LIMIT 1`,
    db<Service[]>`SELECT s.id, s.title, s.description, s.duration_minutes AS "durationMinutes", s.price_cents AS "priceCents", ARRAY(SELECT sl.location_id::text FROM service_locations sl WHERE sl.tenant_id = s.tenant_id AND sl.service_id = s.id) AS "locationIds" FROM services s WHERE s.tenant_id = ${tenant.id} AND s.is_active = true ORDER BY s.title`,
    db<TeamMember[]>`SELECT tm.id, tm.name, stm.service_id AS "serviceId" FROM team_members tm JOIN service_team_members stm ON stm.team_member_id = tm.id AND stm.tenant_id = tm.tenant_id WHERE tm.tenant_id = ${tenant.id} AND tm.is_active = true ORDER BY tm.name`,
    db<Location[]>`SELECT id, name, location_type AS "locationType" FROM locations WHERE tenant_id=${tenant.id} AND is_active=TRUE AND is_online_bookable=TRUE ORDER BY slug='primary' DESC, name`,
  ]);
  if (!settings[0]) notFound();
  const tenantSlug = requestHeaders.get("x-waybook-tenant-route") ?? routeSlugFromHostname(requestHeaders.get("host") ?? "", tenant.slug);
  const bookingPage = parseBookingPage(settings[0].bookingPage);
  const policyRevision = bookingPolicyRevision(bookingPage);
  const visibleServiceIds = bookingPage.visibleServiceIds == null ? null : Array.isArray(bookingPage.visibleServiceIds) ? bookingPage.visibleServiceIds.filter((id): id is string => typeof id === "string") : [];
  const publicServices = visibleServiceIds ? services.filter((service) => visibleServiceIds.includes(service.id)) : services;
  const brandColor = typeof bookingPage.brandColor === "string" && /^#[0-9a-f]{6}$/i.test(bookingPage.brandColor) ? bookingPage.brandColor : undefined;
  const imageUrl = (value: unknown) => typeof value === "string" && (/^https:\/\/[^\s]+$/i.test(value) || /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)) ? value : undefined;
  const httpsUrl = (value: unknown) => typeof value === "string" && /^https:\/\/[^\s]+$/i.test(value) ? value : undefined;
  const panelColor = typeof bookingPage.embedPanelOverlayColor === "string" && /^#[0-9a-f]{6}$/i.test(bookingPage.embedPanelOverlayColor) ? bookingPage.embedPanelOverlayColor : brandColor;
  return <PublicBookingFlow policyRevision={policyRevision} launcherLabel={typeof bookingPage.embedButtonLabel === "string" && bookingPage.embedButtonLabel.trim() ? bookingPage.embedButtonLabel : "Book now"} launcherPosition={bookingPage.embedButtonPosition === "left" ? "left" : "right"} bookingTheme={bookingPage.bookingTheme === "dark" ? "dark" : "light"} managementEnabled initialManage={presets.manage === "1"} tenantSlug={tenantSlug} tenantName={tenant.name} timezone={settings[0].timezone} currency={settings[0].currency} services={publicServices} teamMembers={teamMembers} locations={locations} initialLocationId={locations.some((location) => location.id === presets.location) ? presets.location : undefined} initialServiceId={publicServices.some((service) => service.id === presets.service) ? presets.service : undefined} embedSource={presets.embedSource} embedToken={presets.embedToken} intro={typeof bookingPage.intro === "string" ? bookingPage.intro : undefined} contact={typeof bookingPage.contact === "string" ? bookingPage.contact : undefined} logoUrl={imageUrl(bookingPage.logoUrl)} panelImageUrl={imageUrl(bookingPage.embedPanelImageUrl)} panelOverlayColor={panelColor} panelTitle={typeof bookingPage.embedPanelTitle === "string" ? bookingPage.embedPanelTitle : undefined} panelCopy={typeof bookingPage.embedPanelCopy === "string" ? bookingPage.embedPanelCopy : undefined} policyText={typeof bookingPage.policyText === "string" ? bookingPage.policyText : undefined} policyVersion={typeof bookingPage.policyVersion === "string" ? bookingPage.policyVersion : undefined} policyUrl={httpsUrl(bookingPage.policyUrl)} serviceStepTitle={typeof bookingPage.serviceStepTitle === "string" ? bookingPage.serviceStepTitle : undefined} timeStepTitle={typeof bookingPage.timeStepTitle === "string" ? bookingPage.timeStepTitle : undefined} detailsStepTitle={typeof bookingPage.detailsStepTitle === "string" ? bookingPage.detailsStepTitle : undefined} brandColor={brandColor} showPrices={bookingPage.showPrices !== false} />;
}
