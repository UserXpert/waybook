"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function BookingListRow({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter();
  return <tr tabIndex={0} className="booking-list-row" onClick={event => { if (!(event.target as HTMLElement).closest("a,button,input,select")) router.push(href); }} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); router.push(href); } }}>{children}</tr>;
}
export function CopyBookingValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <span className="booking-copy-value"><span>{value}</span><button type="button" aria-label={`${copied ? "Copied" : "Copy"} ${label}`} title={`${copied ? "Copied" : "Copy"} ${label}`} onClick={async () => { try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); } }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></span>;
}
