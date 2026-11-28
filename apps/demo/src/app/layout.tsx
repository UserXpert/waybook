import type { Metadata } from "next";
import {
  dashboardBackgrounds, dashboardHeaders, dashboardTints, defaultDashboardBackground, defaultDashboardHeader, defaultDashboardTint,
} from "@/lib/waybook/appearance";
import "./globals.css";
import "./ice-blue.css";
import "./workspace-backgrounds.css";
import "./workspace-header.css";
import "./workspace-options.css";

export const metadata: Metadata = {
  title: "Waybook — Booking operations",
  description: "Waybook control and client booking operations dashboards.",
  icons: {
    icon: [
      { url: "/favicon.ico?v=waybook", sizes: "16x16 32x32 48x48" },
      { url: "/favicon.svg?v=waybook", type: "image/svg+xml", sizes: "any" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-waybook-theme="light" data-waybook-header={defaultDashboardHeader} data-waybook-tint={defaultDashboardTint} data-waybook-background={defaultDashboardBackground} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function () {
            try {
              var theme = localStorage.getItem("waybook.theme");
              var tint = localStorage.getItem("waybook.tint");
              var background = localStorage.getItem("waybook.background");
              var header = localStorage.getItem("waybook.header");
              var appearance = document.documentElement.dataset;
              appearance.waybookTheme = theme === "dark" || theme !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
              appearance.waybookTint = ${JSON.stringify(dashboardTints)}.includes(tint) ? tint : ${JSON.stringify(defaultDashboardTint)};
              appearance.waybookBackground = ${JSON.stringify(dashboardBackgrounds)}.includes(background) ? background : ${JSON.stringify(defaultDashboardBackground)};
              appearance.waybookHeader = ${JSON.stringify(dashboardHeaders)}.includes(header) ? header : ${JSON.stringify(defaultDashboardHeader)};
            } catch (error) {}
          })();
        ` }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
