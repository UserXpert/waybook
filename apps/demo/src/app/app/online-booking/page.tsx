import Link from "next/link";
import { headers } from "next/headers";
import { OnlineBookingEmbedDesigner, OnlineBookingEmbedSnapshot, MobileBookingPreview } from "@/components/online-booking-embed-designer";
import { OnlineBookingLocations } from "@/components/online-booking-locations";
import { OnlineBookingPolicy } from "@/components/online-booking-policy";
import { OnlineBookingServices } from "@/components/online-booking-services";
import { OnlineBookingCodes } from "@/components/online-booking-codes";
import { TenantDashboardNav } from "@/components/tenant-dashboard-nav";
import { tenantDb } from "@/lib/waybook/database";
import { requireFeature } from "@/lib/waybook/features";
import { currentTenantRouteSlug, requireTenantWorkspace } from "@/lib/waybook/tenant-context";
import { tenantPath } from "@/lib/waybook/tenant-routes";
import { staffPermissionContext } from "@/lib/waybook/staff-permissions";
import { saveOnlineBookingSettings } from "./actions";

type BookingPage = { bookingTheme?: "light" | "dark"; intro?: string; contact?: string; brandColor?: string; logoUrl?: string; policyVersion?: string; policyUrl?: string; policyText?: string; embedOrigins?: string[]; embedButtonLabel?: string; embedButtonPosition?: string; embedPanelImageUrl?: string; embedPanelOverlayColor?: string; embedPanelTitle?: string; embedPanelCopy?: string; serviceStepTitle?: string; timeStepTitle?: string; detailsStepTitle?: string; showPrices?: boolean; visibleServiceIds?: string[] };
type Service = { id: string; title: string; durationMinutes: number; priceCents: number; isActive: boolean };
function parse(value: BookingPage | string | null | undefined): BookingPage { if (typeof value !== "string") return value ?? {}; try { return JSON.parse(value) as BookingPage; } catch { return {}; } }

export default async function OnlineBookingPage() {
  const { tenant, membership } = await requireTenantWorkspace(); await requireFeature(tenant.id, "booking-essentials");
  const permissions = await staffPermissionContext(tenant, membership); if (!permissions.isManager && !permissions.canManageServiceSettings) throw new Error("You do not have permission to manage online booking.");
  const [settings] = await tenantDb(tenant)<{ bookingPage: BookingPage | string | null; currency: string }[]>`SELECT currency, booking_page AS "bookingPage" FROM tenant_settings WHERE tenant_id=${tenant.id}`;
  const services = await tenantDb(tenant)<Service[]>`SELECT id,title,duration_minutes AS "durationMinutes",price_cents AS "priceCents",is_active AS "isActive" FROM services WHERE tenant_id=${tenant.id} ORDER BY title`;
  const locations = await tenantDb(tenant)<{ id: string; name: string; locationType: string; isOnlineBookable: boolean }[]>`SELECT id,name,location_type AS "locationType",is_online_bookable AS "isOnlineBookable" FROM locations WHERE tenant_id=${tenant.id} AND is_active=TRUE ORDER BY name`;
  const page = parse(settings?.bookingPage); const selected = new Set(page.visibleServiceIds ?? services.filter((item) => item.isActive).map((item) => item.id));
  const slug = await currentTenantRouteSlug(tenant.slug); const publicUrl = tenantPath(slug, "/book"); const requestHeaders = await headers(); const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"); const protocol = requestHeaders.get("x-forwarded-proto") ?? "http"; const absolutePublicUrl = host ? `${protocol}://${host}${publicUrl}` : publicUrl; const scriptUrl = host ? `${protocol}://${host}/${slug}/api/public/embed` : `/${slug}/api/public/embed`;
  return <main className="waybook-data-page tenant-dashboard-page online-booking-page">
    <TenantDashboardNav tenantId={tenant.id} tenantSlug={slug} tenantName={tenant.name} active="onlineBooking" />
    <form id="online-booking-settings" action={saveOnlineBookingSettings} className="online-booking-tabs">
      <input type="hidden" name="intro" value={page.intro ?? ""} /><input type="hidden" name="contact" value={page.contact ?? ""} /><input id="booking-tab-embed" name="booking-editor-tab" type="radio" defaultChecked /><input id="booking-tab-locations" name="booking-editor-tab" type="radio" /><input id="booking-tab-policy" name="booking-editor-tab" type="radio" /><input id="booking-tab-services" name="booking-editor-tab" type="radio" /><input id="booking-tab-codes" name="booking-editor-tab" type="radio" />
      <nav aria-label="Booking settings"><label htmlFor="booking-tab-embed">Website embed</label><label htmlFor="booking-tab-services">Services</label><label htmlFor="booking-tab-locations">Locations</label><label htmlFor="booking-tab-policy">Cancellation / Reschedule</label><label htmlFor="booking-tab-codes">Codes</label><div className="online-booking-page__actions"><Link href={publicUrl} target="_blank" rel="noreferrer">Open booking page <span aria-hidden="true">↗</span></Link><button form="online-booking-settings" type="submit">Save changes</button></div></nav>
      <aside className="online-booking-persistent-preview"><OnlineBookingEmbedSnapshot tenantSlug={slug} timezone={tenant.timezone} managementEnabled initial={page} services={services.filter((item) => item.isActive)} selectedIds={[...selected]} currency={settings?.currency ?? "DKK"} tenantName={tenant.name} locations={locations.filter(location => location.isOnlineBookable)} allLocations={locations} /></aside><MobileBookingPreview tenantSlug={slug} timezone={tenant.timezone} managementEnabled initial={page} services={services.filter((item) => item.isActive)} selectedIds={[...selected]} currency={settings?.currency ?? "DKK"} tenantName={tenant.name} locations={locations.filter(location => location.isOnlineBookable)} allLocations={locations} />
      <section className="online-booking-tab online-booking-tab--services"><OnlineBookingServices services={services} selectedIds={[...selected]} initialShowPrices={page.showPrices !== false} currency={settings?.currency ?? "DKK"} /></section>
      <section className="online-booking-tab online-booking-tab--locations"><OnlineBookingLocations locations={locations} /></section>
      <section className="online-booking-tab online-booking-tab--policy"><OnlineBookingPolicy managementUrl={`${absolutePublicUrl}?manage=1`} initialText={page.policyText ?? ""} initialUrl={page.policyUrl ?? ""} initialVersion={page.policyVersion ?? ""} /></section>
      <section className="online-booking-tab online-booking-tab--embed"><OnlineBookingEmbedDesigner initial={page} scriptUrl={scriptUrl} compact /></section>
      <section className="online-booking-tab online-booking-tab--codes"><OnlineBookingCodes bookingUrl={absolutePublicUrl} scriptUrl={scriptUrl} origins={page.embedOrigins ?? []} /></section>
    </form>
  </main>;
}
