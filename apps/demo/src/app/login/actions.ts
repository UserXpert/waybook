"use server";

import { redirect } from "next/navigation";
import { identityLandingPath, signIn } from "@/lib/waybook/auth";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const identity = await signIn(email, password);
  if (!identity) redirect("/login?error=invalid");
  redirect(await identityLandingPath(identity));
}
