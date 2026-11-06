"use client";

import { Monitor, Moon, Palette, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type ThemeChoice = "system" | "light" | "dark";
type TintChoice = "neutral" | "blue" | "violet" | "rose";

const themeChoices: { id: ThemeChoice; label: string; Icon: typeof Monitor }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];
const tintChoices: { id: TintChoice; label: string }[] = [
  { id: "neutral", label: "Neutral" },
  { id: "blue", label: "Blue" },
  { id: "violet", label: "Violet" },
  { id: "rose", label: "Rose" },
];

function applyAppearance(theme: ThemeChoice, tint: TintChoice) {
  const resolved = theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme === "system" ? "light" : theme;
  document.documentElement.dataset.waybookTheme = resolved;
  document.documentElement.dataset.waybookTint = tint;
}

export function applyStoredTenantAppearance() {
  const storedTheme = localStorage.getItem("waybook.theme") as ThemeChoice | null;
  const storedTint = localStorage.getItem("waybook.tint") as TintChoice | null;
  const theme = themeChoices.some((choice) => choice.id === storedTheme) ? storedTheme! : "system";
  const tint = tintChoices.some((choice) => choice.id === storedTint) ? storedTint! : "neutral";
  applyAppearance(theme, tint);
  return { theme, tint };
}

export function TenantAppearanceControls() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [tint, setTint] = useState<TintChoice>("neutral");

  useEffect(() => {
    const { theme: nextTheme, tint: nextTint } = applyStoredTenantAppearance();
    setTheme(nextTheme); setTint(nextTint);
  }, []);

  const chooseTheme = (next: ThemeChoice) => { setTheme(next); localStorage.setItem("waybook.theme", next); applyAppearance(next, tint); };
  const chooseTint = (next: TintChoice) => { setTint(next); localStorage.setItem("waybook.tint", next); applyAppearance(theme, next); };

  return <section className="tenant-appearance" aria-label="Appearance preferences">
    <header><Palette aria-hidden="true" /><span>Appearance</span></header>
    <div className="tenant-appearance__themes" role="group" aria-label="Colour mode">{themeChoices.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={theme === id} onClick={() => chooseTheme(id)}><Icon aria-hidden="true" />{label}</button>)}</div>
    <div className="tenant-appearance__tints" role="group" aria-label="Accent tint">{tintChoices.map(({ id, label }) => <button key={id} type="button" aria-pressed={tint === id} onClick={() => chooseTint(id)}><i aria-hidden="true" />{label}</button>)}</div>
  </section>;
}
