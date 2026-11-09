"use client";

import { useState } from "react";

export function OnlineBookingShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  return <div className="online-booking-share-link"><code>{url}</code><button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button></div>;
}
