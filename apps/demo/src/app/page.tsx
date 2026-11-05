import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/waybook/auth";

export default async function Home() {
  const identity = await requireIdentity();
  redirect(identity.isPlatformAdmin ? "/control" : "/app");
}
