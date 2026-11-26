"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { signIn } from "@/lib/waybook/auth";
import { loginPathForTenant } from "@/lib/waybook/tenant-routes";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const rememberMe = formData.get("rememberMe") === "on";
  if (!(await signIn(email, password, rememberMe))) {
    const loginPath = loginPathForTenant((await headers()).get("x-waybook-tenant-route"));
    redirect(`${loginPath}?error=invalid`);
  }
  redirect("/");
}
