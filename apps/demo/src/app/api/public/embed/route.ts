import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";

type BookingPage = { bookingTheme?: unknown; embedOrigins?: unknown; brandColor?: unknown; embedButtonLabel?: unknown; embedButtonPosition?: unknown };

function embedOrigins(value: BookingPage | string | null | undefined) {
  const page = typeof value === "string" ? (() => { try { return JSON.parse(value) as BookingPage; } catch { return {}; } })() : value;
  return Array.isArray(page?.embedOrigins) ? page.embedOrigins.filter((item): item is string => typeof item === "string") : [];
}

/** A source-specific launcher; the nested frame is protected by CSP and the
 * public booking page itself is same-origin-frame-only. */
export async function GET(request: NextRequest) {
  const tenant = await tenantForPublicRequest(request.headers);
  if (!tenant || !await isFeatureEnabled(tenant.id, "booking-essentials")) return new NextResponse("", { status: 404 });
  const [settings] = await tenantDb(tenant)<{ bookingPage: BookingPage | string | null }[]>`SELECT booking_page AS "bookingPage" FROM tenant_settings WHERE tenant_id=${tenant.id}`;
  const page = typeof settings?.bookingPage === "string" ? (() => { try { return JSON.parse(settings.bookingPage) as BookingPage; } catch { return {}; } })() : settings?.bookingPage ?? {};
  const origins = embedOrigins(page);
  const appOrigin = request.nextUrl.origin;
  const tenantPath = `/${request.headers.get("x-waybook-tenant-route") ?? tenant.slug}`;
  const buttonLabel = typeof page.embedButtonLabel === "string" && page.embedButtonLabel ? page.embedButtonLabel : "Book now";
  const buttonPosition = page.embedButtonPosition === "left" ? "left" : "right";
  const buttonColour = typeof page.brandColor === "string" && /^#[0-9a-f]{6}$/i.test(page.brandColor) ? page.brandColor : "#1f2937";
  const isDark = page.bookingTheme === "dark";
  const darker = `#${[1, 3, 5].map((offset) => Math.round(parseInt(buttonColour.slice(offset, offset + 2), 16) * 0.82).toString(16).padStart(2, "0")).join("")}`;
  const script = `(function(){var s=document.currentScript;if(!s||${JSON.stringify(origins)}.indexOf(window.location.origin)<0)return;var q=new URLSearchParams();if(s.dataset.location)q.set('location',s.dataset.location);if(s.dataset.service)q.set('service',s.dataset.service);var launcher=document.createElement('div');launcher.style.cssText='position:fixed;z-index:2147483646;bottom:24px;${buttonPosition}:24px;display:flex;align-items:center;flex-direction:column;gap:5px';var link=document.createElement('button');link.type='button';link.textContent=s.dataset.label||${JSON.stringify(buttonLabel)};link.setAttribute('aria-label','Book an appointment');link.style.cssText='padding:14px 20px;border:0;border-radius:999px;background:${darker};color:#fff;font:700 16px system-ui,sans-serif;box-shadow:0 12px 28px rgba(0,0,0,.22);cursor:pointer';link.addEventListener('click',function(){var layer=document.createElement('div');layer.setAttribute('role','dialog');layer.setAttribute('aria-modal','true');layer.setAttribute('aria-label','Book an appointment');layer.style.cssText='position:fixed;z-index:2147483647;inset:0;padding:24px;background:rgba(8,12,18,.68);display:grid;place-items:center';var frame=document.createElement('iframe');frame.title='Book an appointment';frame.src='${appOrigin}${tenantPath}/embed?source='+encodeURIComponent(window.location.origin)+(q.toString()?'&'+q:'');frame.style.cssText='width:min(1120px,100%);height:min(760px,100%);border:0;border-radius:22px;background:#fff;box-shadow:0 24px 80px rgba(0,0,0,.38)';var close=function(){layer.remove();link.focus()};var closeButton=document.createElement('button');closeButton.type='button';closeButton.textContent='×';closeButton.setAttribute('aria-label','Close booking');closeButton.style.cssText='position:absolute;z-index:1;top:34px;right:34px;width:40px;height:40px;border:0;border-radius:999px;background:#fff;color:#1c1c20;font:400 32px/1 system-ui;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer';closeButton.addEventListener('click',close);layer.addEventListener('click',function(e){if(e.target===layer)close()});layer.append(frame,closeButton);document.body.append(layer);closeButton.focus();document.addEventListener('keydown',function k(e){if(e.key==='Escape'){close();document.removeEventListener('keydown',k)}})});var badge=document.createElement('span');badge.style.cssText='display:flex;align-items:center;gap:4px;padding:3px 7px;border-radius:6px;background:${isDark ? "#202529" : "#fff"};color:${isDark ? "#fff" : "#202529"};font:500 10px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.14)';badge.append(document.createTextNode('Powered by'));var logo=document.createElement('img');logo.src=${JSON.stringify(appOrigin + '/brand/waybook-logo-white.svg')};logo.alt='Waybook';logo.style.cssText='width:48px;height:auto;${isDark ? "" : "filter:brightness(0);"}';badge.append(logo);launcher.append(link,badge);document.body.append(launcher)})();`;
  return new NextResponse(script, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
