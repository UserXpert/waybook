import { redirect } from "next/navigation";
import { identityLandingPath, requireIdentity } from "@/lib/waybook/auth";

export default async function Home() {
  redirect(await identityLandingPath(await requireIdentity()));
}
