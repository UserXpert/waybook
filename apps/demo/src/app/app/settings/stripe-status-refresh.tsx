"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function StripeStatusRefresh({ awaitingStripe }: { awaitingStripe: boolean }) {
  const router = useRouter();
  useEffect(() => {
    let lastRefresh = Date.now();
    function refresh() {
      if (document.visibilityState !== "visible" || Date.now() - lastRefresh < 5_000) return;
      lastRefresh = Date.now();
      router.refresh();
    }
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = awaitingStripe ? window.setInterval(refresh, 30_000) : undefined;
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [awaitingStripe, router]);
  return null;
}
