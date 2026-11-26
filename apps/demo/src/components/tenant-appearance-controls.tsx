"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dashboardBackgrounds, dashboardTints, defaultDashboardBackground, defaultDashboardTint,
  type DashboardBackground, type DashboardTint,
} from "@/lib/waybook/appearance";

type ThemeChoice = "system" | "light" | "dark";
type TintChoice = DashboardTint;

const themeChoices: { id: ThemeChoice; label: string; Icon: typeof Monitor }[] = [
  { id: "system", label: "System", Icon: Monitor },
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
];
const tintLabels: Record<TintChoice, string> = {
  blue: "Ice Blue", neutral: "Neutral", violet: "Violet", rose: "Rose",
  teal: "Teal", coral: "Coral", amber: "Amber",
};
const backgroundLabels: Record<DashboardBackground, string> = {
  ripple: "Ripple", folds: "Folds", horizon: "Horizon", linen: "Linen", plain: "Plain",
};

function applyAppearance(theme: ThemeChoice, tint: TintChoice, background: DashboardBackground) {
  const resolved = theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme === "system" ? "light" : theme;
  document.documentElement.dataset.waybookTheme = resolved;
  document.documentElement.dataset.waybookTint = tint;
  document.documentElement.dataset.waybookBackground = background;
}

export function applyStoredTenantAppearance() {
  const storedTheme = localStorage.getItem("waybook.theme") as ThemeChoice | null;
  const storedTint = localStorage.getItem("waybook.tint") as TintChoice | null;
  const storedBackground = localStorage.getItem("waybook.background") as DashboardBackground | null;
  const theme = themeChoices.some((choice) => choice.id === storedTheme) ? storedTheme! : "system";
  const tint = storedTint && dashboardTints.includes(storedTint) ? storedTint : defaultDashboardTint;
  const background = storedBackground && dashboardBackgrounds.includes(storedBackground) ? storedBackground : defaultDashboardBackground;
  applyAppearance(theme, tint, background);
  return { theme, tint, background };
}

export function TenantAppearanceControls() {
  const [theme, setTheme] = useState<ThemeChoice>("system");
  const [tint, setTint] = useState<TintChoice>(defaultDashboardTint);
  const [background, setBackground] = useState<DashboardBackground>(defaultDashboardBackground);

  useEffect(() => {
    const preferences = applyStoredTenantAppearance();
    setTheme(preferences.theme);
    setTint(preferences.tint);
    setBackground(preferences.background);
  }, []);

  const chooseTheme = (next: ThemeChoice) => { setTheme(next); localStorage.setItem("waybook.theme", next); applyAppearance(next, tint, background); };
  const chooseTint = (next: TintChoice) => { setTint(next); localStorage.setItem("waybook.tint", next); applyAppearance(theme, next, background); };
  const chooseBackground = (next: DashboardBackground) => {
    setBackground(next);
    localStorage.setItem("waybook.background", next);
    applyAppearance(theme, tint, next);
  };

  return <section className="tenant-appearance" aria-label="Appearance preferences">
    <h3>Colour mode</h3>
    <div className="tenant-appearance__themes" role="group" aria-label="Colour mode">{themeChoices.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={theme === id} onClick={() => chooseTheme(id)}><Icon aria-hidden="true" />{label}</button>)}</div>
    <h3>Accent tint</h3>
    <div className="tenant-appearance__tints" role="group" aria-label="Accent tint">{dashboardTints.map((id) => <button key={id} type="button" aria-label={tintLabels[id]} title={tintLabels[id]} aria-pressed={tint === id} onClick={() => chooseTint(id)}><i aria-hidden="true" /><span className="sr-only">{tintLabels[id]}</span></button>)}</div>
    <h3>Background pattern</h3>
    <div className="tenant-appearance__backgrounds" role="group" aria-label="Background pattern">
      {dashboardBackgrounds.map((id) => (
        <button key={id} type="button" aria-pressed={background === id} onClick={() => chooseBackground(id)}>
          <span className="tenant-appearance__pattern" data-pattern={id} aria-hidden="true" />
          {backgroundLabels[id]}
        </button>
      ))}
    </div>
  </section>;
}
