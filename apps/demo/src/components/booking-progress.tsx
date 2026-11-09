import { Check } from "lucide-react";
import type { CSSProperties } from "react";

export function BookingProgress({ step, color = "#1f2937" }: { step: number; color?: string }) {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  const hex = match?.[1] ?? "1f2937";
  const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  const light = channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179;
  return <div className="booking-step-progress" style={{ "--progress-ink": light ? "#111" : "#fff" } as CSSProperties} role="progressbar" aria-label="Booking progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step}><div className="booking-step-progress__line" /><div className="booking-step-progress__filled" style={{ width: `${(Math.min(3, Math.max(1, step)) - 1) * 50}%` }} />{[1, 2, 3].map(number => <span key={number} className={number < step ? "is-complete" : number === step ? "is-current" : "is-upcoming"}>{number < step ? <Check aria-hidden="true" size={12} strokeWidth={2.5} /> : number === step ? <i /> : number}</span>)}</div>;
}
