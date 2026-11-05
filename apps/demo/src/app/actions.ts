"use server";

import { signOut } from "@/lib/waybook/auth";

/** Ends the current database-backed Waybook session. */
export async function logout() {
  await signOut();
}
