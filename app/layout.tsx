import type { Metadata } from "next";
import { ServiceWorkerCleanup } from "@/components/ServiceWorkerCleanup";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wai & Aina Homeapp",
  description: "Schedules, guides, and farm life for Wai & Aina.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <link rel="apple-touch-icon" href="/logo.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#fdfcf9" />
      </head>
      <body className="antialiased">
        {children}
        <ServiceWorkerCleanup />
      </body>
    </html>
  );
}
