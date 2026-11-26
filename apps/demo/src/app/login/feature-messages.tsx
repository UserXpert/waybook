"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

const messages = [
  {
    lines: ["Clear days.", "Calmer teams."],
    description: "Manage bookings, staff and studio resources in one place.",
  },
  {
    lines: ["Staff schedules.", "In one place."],
    description: "Plan shifts and see who is available across your locations.",
  },
  {
    lines: ["Online booking.", "On your site."],
    description: "Let clients book from your website using your live availability.",
  },
];

const motionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void) {
  const preference = window.matchMedia(motionQuery);
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia(motionQuery).matches;
}

function serverPrefersReducedMotion() {
  return true;
}

export function FeatureMessages() {
  const [activeIndex, setActiveIndex] = useState(0);
  const [playOverride, setPlayOverride] = useState<boolean | null>(null);
  const reduceMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, serverPrefersReducedMotion);
  const playing = playOverride ?? !reduceMotion;
  const Icon = playing ? Pause : Play;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setActiveIndex((current) => (current + 1) % messages.length), 8000);
    return () => window.clearInterval(timer);
  }, [playing]);

  return (
    <div className="waybook-login-showcase-copy">
      <div className="waybook-login-feature-messages" aria-live="off">
        {messages.map(({ lines, description }, index) => (
          <div key={lines[0]} aria-hidden={activeIndex !== index}>
            <p>{lines[0]}<br />{lines[1]}</p>
            <span>{description}</span>
          </div>
        ))}
      </div>
      <button
        type="button"
        aria-label={playing ? "Pause feature messages" : "Play feature messages"}
        onClick={() => setPlayOverride(!playing)}
      >
        <Icon size={15} aria-hidden="true" />
      </button>
    </div>
  );
}
