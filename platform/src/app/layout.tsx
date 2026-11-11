import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import "./globals.css";
import "../theme.css";

export const metadata: Metadata = {
  title: "Namma Bill POS",
  description: "Secure billing and GST workspace for Chinnathambi Traders",
  applicationName: "Namma Bill POS",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: "#5543d1",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}<ServiceWorkerRegistration /></body>
    </html>
  );
}
