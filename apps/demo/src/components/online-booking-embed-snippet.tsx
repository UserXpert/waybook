"use client";

import { useState } from "react";

export function OnlineBookingEmbedSnippet({ scriptUrl }: { scriptUrl: string }) {
  const [copied, setCopied] = useState(false);
  const snippet = `<script src="${scriptUrl}" async></script>`;

  const copy = async () => {
    await navigator.clipboard.writeText(snippet).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return <div className="online-booking-embed-snippet">
    <code>{snippet}</code>
    <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy code"}</button>
  </div>;
}
