"use server";

import { redirect } from "next/navigation";
import { signIn } from "@/lib/waybook/auth";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!(await signIn(email, password))) redirect("/login?error=invalid");
  redirect("/");
}
