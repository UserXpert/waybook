"use client";

import { useState } from "react";

export function OnlineBookingPolicy({ initialText, initialUrl, initialVersion, managementUrl }: { managementUrl?: string; initialText: string; initialUrl: string; initialVersion: string }) {
  const [text, setText] = useState(initialText);
  const [url, setUrl] = useState(initialUrl);
  const [version, setVersion] = useState(initialVersion);
  const reveal = () => { const tab = document.getElementById("booking-tab-policy") as HTMLInputElement | null; tab?.click(); };
  return <div className="online-booking-tab__content" onInvalid={reveal}><div className="online-booking-tab__heading"><p className="online-booking-kicker">CANCELLATION / RESCHEDULE</p><h2>Set expectations before booking</h2><span>Share your policy and ask customers to agree before confirming.</span></div><div className="online-booking-policy__fields">{managementUrl ? <label>Cancellation and rescheduling link<input readOnly value={managementUrl} onFocus={event => event.currentTarget.select()} /><small>Share this link with customers so they can find and manage their booking.</small></label> : null}<label>Cancellation and reschedule policy<textarea name="policyText" rows={5} maxLength={1000} value={text} onChange={event => setText(event.target.value)} required={Boolean(version.trim() && !url.trim())} placeholder="Explain your cancellation and rescheduling terms" /><small>Shown to customers before they book. Fees and deadlines are not automatically enforced.</small></label><label>Policy link<input name="policyUrl" type="url" pattern="https://.*" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/booking-policy" /><small>Optional HTTPS link to the full policy.</small></label><label>Policy name or version<input name="policyVersion" maxLength={80} value={version} onChange={event => setVersion(event.target.value)} required={Boolean(text.trim() || url.trim())} placeholder="e.g. Cancellation policy" /><small>Add a name when using policy text or a link to require agreement.</small></label></div></div>;
}
