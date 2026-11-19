"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { redirectSuccessToastMessage, showSuccessToast, WAYBOOK_TOAST_EVENT, type WaybookToastDetail } from "@/lib/waybook/toast";

const AUTO_DISMISS_MS = 4_500;

function TenantSuccessToastListener() {
  const [message, setMessage] = useState<string | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const receiveToast = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (!detail || typeof detail !== "object" || typeof (detail as WaybookToastDetail).message !== "string") return;
      const nextMessage = (detail as WaybookToastDetail).message.trim();
      if (nextMessage) setMessage(nextMessage);
    };

    window.addEventListener(WAYBOOK_TOAST_EVENT, receiveToast);
    return () => window.removeEventListener(WAYBOOK_TOAST_EVENT, receiveToast);
  }, []);

  useEffect(() => {
    const consumeRedirectToast = () => {
      const url = new URL(window.location.href);
      const redirectMessage = redirectSuccessToastMessage(searchParams.get("toast"));
      if (!redirectMessage) return;
      url.searchParams.delete("toast");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      showSuccessToast(redirectMessage);
    };
    consumeRedirectToast();
  }, [searchParams]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(null), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [message]);

  if (!message) return null;

  return <div className="waybook-success-toast-region" aria-live="polite" aria-atomic="true">
    <div className="waybook-success-toast" role="status">
      <span>{message}</span>
      <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss notification">×</button>
    </div>
  </div>;
}

const ToastSuspense = Suspense as unknown as (props: { fallback: null; children: ReturnType<typeof TenantSuccessToastListener> }) => ReturnType<typeof TenantSuccessToastListener>;

export function TenantSuccessToast() {
  return <ToastSuspense fallback={null}><TenantSuccessToastListener /></ToastSuspense>;
}
