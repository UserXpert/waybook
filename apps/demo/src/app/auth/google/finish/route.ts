import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createWaybookSession } from "@/lib/waybook/auth";
import { findTenantRouteSlug } from "@/lib/waybook/database";
import { getGoogleAuth, googleFinishPath, googleInvitationCookie, googleSignInAvailable } from "@/lib/waybook/google-auth";
import { redeemGoogleSession } from "@/lib/waybook/staff-invitations";
import { tenantPath } from "@/lib/waybook/tenant-routes";

export async function GET(request: Request) {
  const configured = getGoogleAuth();
  const url = new URL(request.url);
  if (!configured || url.origin !== configured.origin || !(await googleSignInAvailable())) {
    return new Response(null, { status: 404 });
  }
  const attempt = url.searchParams.get("attempt");
  let token: string | undefined;
  if (attempt !== null) {
    if (!/^[a-f0-9]{32}$/.test(attempt)) redirect("/login?google=denied");
    const store = await cookies();
    const key = googleInvitationCookie(attempt);
    token = store.get(key)?.value;
    store.set(key, "", { path: googleFinishPath, maxAge: 0 });
    if (!token) redirect("/login?google=denied");
  }

  let destination = "/login?google=denied";
  try {
    const exchange = await configured.auth.api.getSession({ headers: request.headers });
    if (exchange) {
      const accepted = await redeemGoogleSession(exchange.session.id, exchange.user.id, token);
      await configured.auth.api.signOut({ headers: request.headers });
      if (accepted) {
        const workspace = accepted.tenantId && accepted.tenantSlug
          ? tenantPath(await findTenantRouteSlug(accepted.tenantId, accepted.tenantSlug))
          : "/";
        await createWaybookSession(accepted.identityId);
        destination = workspace;
      }
    }
  } catch {
    console.error("Google sign-in could not be completed.");
    destination = "/login?google=unavailable";
  }
  redirect(destination);
}
