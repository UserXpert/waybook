"use client";

import { useState } from "react";

type Code = { title: string; description: string; value: string; label: string };

export function OnlineBookingCodes({ bookingUrl, scriptUrl, origins }: { bookingUrl: string; scriptUrl: string; origins: string[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const codes: Code[] = [
    { title: "Booking link", description: "Share this direct link in messages, social posts, or your profile.", value: bookingUrl, label: "Copy link" },
    { title: "Website launcher", description: "Paste this once on an approved website to show the floating Book now button.", value: `<script src="${scriptUrl}" async></script>`, label: "Copy code" },
    { title: "Link button", description: "Use this simple fallback where scripts are not available, such as an email template.", value: `<a href="${bookingUrl}">Book now</a>`, label: "Copy code" },
  ];
  const copy = async (title: string, value: string) => { try { await navigator.clipboard.writeText(value); setCopied(title); } catch { setCopied("error:" + title); } window.setTimeout(() => setCopied(null), 1600); };
  return <div className="online-booking-codes"><div className="online-booking-tab__heading"><p className="online-booking-kicker">SHARE & INSTALL</p><h2>Booking links and code</h2><span>Use the booking link anywhere, or install the launcher on an approved website.</span></div><article><div><h3>Approved websites</h3><p>Add one complete website origin per line, including https://. Localhost may use http://.</p></div><textarea name="embedOrigins" rows={3} defaultValue={origins.join("\n")} placeholder="https://example.com" /></article>{codes.map((code) => <article key={code.title}><div><h3>{code.title}</h3><p>{code.description}</p></div><div className="online-booking-codes__value"><code>{code.value}</code><button type="button" onClick={() => void copy(code.title, code.value)}>{copied === code.title ? "Copied" : copied === "error:" + code.title ? "Copy failed" : code.label}</button></div></article>)}</div>;
}
