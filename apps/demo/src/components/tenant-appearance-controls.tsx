"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import {
  dashboardBackgrounds, dashboardHeaders, dashboardTints, defaultDashboardBackground, defaultDashboardHeader, defaultDashboardTint,
  type DashboardBackground, type DashboardHeader, type DashboardTint,
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
const headerLabels: Record<DashboardHeader, string> = { light: "Light", dark: "Dark" };
type Appearance = { theme: ThemeChoice; tint: TintChoice; background: DashboardBackground; header: DashboardHeader };

function applyAppearance({ theme, tint, background, header }: Appearance) {
  const resolved = theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme === "system" ? "light" : theme;
  document.documentElement.dataset.waybookTheme = resolved;
  document.documentElement.dataset.waybookTint = tint;
  document.documentElement.dataset.waybookBackground = background;
  document.documentElement.dataset.waybookHeader = header;
}

export function applyStoredTenantAppearance() {
  const storedTheme = localStorage.getItem("waybook.theme") as ThemeChoice | null;
  const storedTint = localStorage.getItem("waybook.tint") as TintChoice | null;
  const storedBackground = localStorage.getItem("waybook.background") as DashboardBackground | null;
  const storedHeader = localStorage.getItem("waybook.header") as DashboardHeader | null;
  const theme = themeChoices.some((choice) => choice.id === storedTheme) ? storedTheme! : "system";
  const tint = storedTint && dashboardTints.includes(storedTint) ? storedTint : defaultDashboardTint;
  const background = storedBackground && dashboardBackgrounds.includes(storedBackground) ? storedBackground : defaultDashboardBackground;
  const header = storedHeader && dashboardHeaders.includes(storedHeader) ? storedHeader : defaultDashboardHeader;
  const preferences = { theme, tint, background, header };
  applyAppearance(preferences);
  return preferences;
}

export function TenantAppearanceControls() {
  const [preferences, setPreferences] = useState<Appearance>({
    theme: "system", tint: defaultDashboardTint, background: defaultDashboardBackground, header: defaultDashboardHeader,
  });
  const { theme, tint, background, header } = preferences;

  useEffect(() => {
    setPreferences(applyStoredTenantAppearance());
  }, []);

  function choose<Key extends keyof Appearance>(key: Key, value: Appearance[Key]) {
    const next = { ...preferences, [key]: value };
    localStorage.setItem(`waybook.${key}`, value);
    setPreferences(next);
    applyAppearance(next);
  }

  return <section className="tenant-appearance" aria-label="Appearance preferences">
    <h3>Colour mode</h3>
    <div className="tenant-appearance__themes" role="group" aria-label="Colour mode">{themeChoices.map(({ id, label, Icon }) => <button key={id} type="button" aria-pressed={theme === id} onClick={() => choose("theme", id)}><Icon aria-hidden="true" />{label}</button>)}</div>
    <h3>Header</h3>
    <div className="tenant-appearance__themes tenant-appearance__header" role="group" aria-label="Header">
      {dashboardHeaders.map((id) => (
        <button key={id} type="button" aria-pressed={header === id} onClick={() => choose("header", id)}>{headerLabels[id]}</button>
      ))}
    </div>
    <h3>Accent tint</h3>
    <div className="tenant-appearance__tints" role="group" aria-label="Accent tint">{dashboardTints.map((id) => <button key={id} type="button" aria-label={tintLabels[id]} title={tintLabels[id]} aria-pressed={tint === id} onClick={() => choose("tint", id)}><i aria-hidden="true" /><span className="sr-only">{tintLabels[id]}</span></button>)}</div>
    <h3>Background pattern</h3>
    <div className="tenant-appearance__backgrounds" role="group" aria-label="Background pattern">
      {dashboardBackgrounds.map((id, index) => (
        <button key={id} type="button" aria-label={id === "ripple" ? "Ripple" : `Background ${index + 1}`}
          aria-pressed={background === id} onClick={() => choose("background", id)}>
          <span className="tenant-appearance__pattern" data-pattern={id} aria-hidden="true" />
        </button>
      ))}
    </div>
  </section>;
}
