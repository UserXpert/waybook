import { NextRequest, NextResponse } from "next/server";
import { isTenantRouteSlug } from "@/lib/waybook/tenant-routes";

const reservedRoots = new Set(["api", "app", "book", "control", "login", "_next", "favicon.ico"]);

/**
 * Tenant paths stay on one origin (`/{tenant}/…`) and are rewritten internally
 * to the established route tree. The trusted request header is created here;
 * route handlers and server actions resolve the tenant from it on the server.
 */
export function middleware(request: NextRequest) {
  // Never trust a tenant header supplied by a caller. Only this rewrite may set it.
  const headers = new Headers(request.headers);
  headers.delete("x-waybook-tenant-route");
  const [first, ...rest] = request.nextUrl.pathname.split("/").filter(Boolean);
  if (!first || reservedRoots.has(first) || !isTenantRouteSlug(first)) {
    return NextResponse.next({ request: { headers } });
  }
  const target = `/${rest.join("/")}`;
  if (!rest.length || !["app", "book", "embed", "login", "api"].includes(rest[0])) {
    return NextResponse.next({ request: { headers } });
  }

  headers.set("x-waybook-tenant-route", first);
  const url = request.nextUrl.clone();
  url.pathname = target;
  const response = NextResponse.rewrite(url, { request: { headers } });
  // Third parties never frame the booking page directly. An allowlisted
  // Waybook-owned `/embed` document is the sole parent for external embeds.
  if (rest[0] === "book") response.headers.set("X-Frame-Options", "SAMEORIGIN");
  return response;
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
