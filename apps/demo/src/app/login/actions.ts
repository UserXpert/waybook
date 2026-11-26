"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/waybook/auth";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const rememberMe = formData.get("rememberMe") === "on";
  if (!(await signIn(email, password, rememberMe))) redirect("/login?error=invalid");
  redirect("/");
}
