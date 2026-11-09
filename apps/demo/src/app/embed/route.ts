import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/waybook/database";
import { isFeatureEnabled } from "@/lib/waybook/features";
import { tenantForPublicRequest } from "@/lib/waybook/tenant-context";
import { signEmbedSource } from "@/lib/waybook/embed-token";

type BookingPage = { embedOrigins?: unknown; logoUrl?: unknown; embedPanelImageUrl?: unknown; embedPanelOverlayColor?: unknown; embedPanelTitle?: unknown; embedPanelCopy?: unknown };

function embedOrigins(value: BookingPage | string | null | undefined) {
  const page = typeof value === "string" ? (() => { try { return JSON.parse(value) as BookingPage; } catch { return {}; } })() : value;
  return Array.isArray(page?.embedOrigins) ? page.embedOrigins.filter((item): item is string => typeof item === "string") : [];
}

function origin(value: string | null) {
  try { const parsed = new URL(value ?? ""); return parsed.origin === value ? parsed.origin : null; } catch { return null; }
}

export async function GET(request: NextRequest) {
  const tenant = await tenantForPublicRequest(request.headers);
  if (!tenant || !await isFeatureEnabled(tenant.id, "booking-essentials")) return new NextResponse("Not found", { status: 404 });
  const source = origin(request.nextUrl.searchParams.get("source"));
  const [settings] = await tenantDb(tenant)<{ bookingPage: BookingPage | string | null }[]>`SELECT booking_page AS "bookingPage" FROM tenant_settings WHERE tenant_id=${tenant.id}`;
  const page = typeof settings?.bookingPage === "string" ? (() => { try { return JSON.parse(settings.bookingPage) as BookingPage; } catch { return {}; } })() : settings?.bookingPage ?? {};
  const allowed = embedOrigins(page);
  if (!source || !allowed.includes(source)) return new NextResponse("Embedding is not enabled for this website.", { status: 403 });
  const token = signEmbedSource(tenant.id, source);
  if (!token) return new NextResponse("Embedding is not configured.", { status: 503 });
  const tenantRoute = request.headers.get("x-waybook-tenant-route") ?? tenant.slug;
  const bookUrl = new URL(`/${tenantRoute}/book`, request.nextUrl.origin);
  bookUrl.searchParams.set("embedSource", source);
  bookUrl.searchParams.set("embedToken", token);
  for (const name of ["location", "service"]) { const value = request.nextUrl.searchParams.get(name); if (value && /^[0-9a-f-]{36}$/i.test(value)) bookUrl.searchParams.set(name, value); }
  const text = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value.trim().replace(/[<>&"]/g, "") : fallback;
  const image = typeof page.embedPanelImageUrl === "string" && (/^https:\/\/[^\s]+$/i.test(page.embedPanelImageUrl) || /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(page.embedPanelImageUrl)) ? page.embedPanelImageUrl.replace(/"/g, "%22") : "";
  const overlay = typeof page.embedPanelOverlayColor === "string" && /^#[0-9a-f]{6}$/i.test(page.embedPanelOverlayColor) ? page.embedPanelOverlayColor : "#1f2937";
  const logo = typeof page.logoUrl === "string" && (/^https:\/\/[^\s]+$/i.test(page.logoUrl) || /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(page.logoUrl)) ? `<img src="${page.logoUrl.replace(/"/g, "%22")}" alt="${tenant.name.replace(/[<>&"]/g, "")}" />` : `<small>ONLINE BOOKING</small>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Book with ${tenant.name.replace(/[<&]/g, "")}</title><style>html,body{width:100%;height:100%;margin:0;background:#fff;font-family:ui-sans-serif,system-ui}.shell{display:grid;grid-template-columns:minmax(240px,34%) 1fr;width:100%;height:100%;overflow:hidden}.panel{padding:clamp(28px,5vw,64px);color:#fff;background:${overlay}${image ? ` url('${image}') center/cover` : ""};background-blend-mode:multiply;display:flex;flex-direction:column;gap:20px}.panel img{max-width:150px;max-height:48px;object-fit:contain;object-position:left}.panel small{font-weight:800;letter-spacing:.12em}.panel h1{margin:0;font-size:clamp(28px,3vw,46px);line-height:1.04}.panel p{max-width:28ch;margin:0;font-size:17px;line-height:1.5}.flow{min-width:0;height:100%}.flow iframe{width:100%;height:100%;border:0}@media(max-width:700px){.shell{display:block}.panel{display:none}}</style></head><body><main class="shell"><aside class="panel">${logo}<h1>${text(page.embedPanelTitle, "Book your next visit")}</h1><p>${text(page.embedPanelCopy, "Choose a service and a time that works for you.")}</p></aside><section class="flow"><iframe title="Book with ${tenant.name.replace(/"/g, "")}" src="${bookUrl.toString()}"></iframe></section></main></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": `default-src 'self'; frame-src 'self'; frame-ancestors ${source}; base-uri 'none'; form-action 'self'; style-src 'unsafe-inline'; img-src https: data:`, "referrer-policy": "strict-origin-when-cross-origin" } });
}
