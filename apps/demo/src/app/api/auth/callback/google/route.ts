import { toNextJsHandler } from "better-auth/next-js";
import { getGoogleAuth, googleSignInAvailable } from "@/lib/waybook/google-auth";

export async function GET(request: Request) {
  const configured = getGoogleAuth();
  if (!configured || new URL(request.url).origin !== configured.origin || !(await googleSignInAvailable())) {
    return new Response(null, { status: 404 });
  }
  return toNextJsHandler(configured.auth).GET(request);
}
