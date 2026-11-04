import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaRegister } from "@/components/PwaRegister";

/**
 * §9.4: the app is named "Pulse" in the manifest (name + short_name),
 * the tab title, and the splash — all sourced from here.
 */
export const metadata: Metadata = {
  title: "Pulse",
  description: "Pemantauan event harian: opening, monitoring, closing.",
  applicationName: "Pulse",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Pulse",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6fa" },
    { media: "(prefers-color-scheme: dark)", color: "#101624" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
