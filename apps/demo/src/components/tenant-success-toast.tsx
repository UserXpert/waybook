"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createPortal } from "react-dom";
import { redirectSuccessToastMessage, showSuccessToast, WAYBOOK_TOAST_EVENT, type WaybookToastDetail } from "@/lib/waybook/toast";

const AUTO_DISMISS_MS = 4_500;

function TenantSuccessToastListener() {
  const [notification, setNotification] = useState<{ message: string; dialog: HTMLDialogElement | null } | null>(null);
  const searchParams = useSearchParams();

  useEffect(() => {
    const receiveToast = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (event instanceof CustomEvent && detail === null) {
        setNotification(null);
        return;
      }
      if (!detail || typeof detail !== "object" || typeof (detail as WaybookToastDetail).message !== "string") return;
      const nextMessage = (detail as WaybookToastDetail).message.trim();
      if (nextMessage) {
        const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog:modal");
        const dialog = dialogs[dialogs.length - 1] ?? null;
        const hasInlineStatus = Array.from(dialog?.querySelectorAll('[role="status"]') ?? [])
          .some((status) => !status.closest(".waybook-success-toast-region")
            && status.getClientRects().length > 0 && status.textContent?.trim() === nextMessage);
        setNotification(hasInlineStatus ? null : { message: nextMessage, dialog });
      }
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
    if (!notification) return;
    const timeout = window.setTimeout(() => setNotification(null), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [notification]);

  const dialog = notification?.dialog;
  const dismissOnClose = dialog?.hasAttribute("data-dismiss-success-toast-on-close");
  useEffect(() => {
    if (!dialog) return;
    const afterClose = () => setNotification((current) => {
      if (current?.dialog !== dialog) return current;
      return dismissOnClose ? null : { ...current, dialog: null };
    });
    if (!dialog.open) afterClose();
    else dialog.addEventListener("close", afterClose, { once: true });
    return () => dialog.removeEventListener("close", afterClose);
  }, [dialog, dismissOnClose]);

  if (!notification || (dismissOnClose && !dialog?.open)) return null;

  const toast = <div className="waybook-success-toast-region" aria-live="polite" aria-atomic="true">
    <div className="waybook-success-toast" role="status">
      <span>{notification.message}</span>
      <button type="button" onClick={() => setNotification(null)} aria-label="Dismiss notification">×</button>
    </div>
  </div>;
  return dialog?.open ? createPortal(toast, dialog) : toast;
}

const ToastSuspense = Suspense as unknown as (props: { fallback: null; children: ReturnType<typeof TenantSuccessToastListener> }) => ReturnType<typeof TenantSuccessToastListener>;

export function TenantSuccessToast() {
  return <ToastSuspense fallback={null}><TenantSuccessToastListener /></ToastSuspense>;
}
