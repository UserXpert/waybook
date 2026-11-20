import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var theme=localStorage.getItem("waybook.theme");var tint=localStorage.getItem("waybook.tint");var resolved=theme==="dark"||theme!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.waybookTheme=resolved;document.documentElement.dataset.waybookTint=["blue","violet","rose","teal","coral","amber"].includes(tint||"")?tint:"neutral";}catch(e){}})();` }} />
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
