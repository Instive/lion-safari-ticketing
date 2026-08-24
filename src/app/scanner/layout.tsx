import type { Metadata, Viewport } from "next";

import { EnvBanner } from "@/components/staff/env-banner";
import { ServiceWorkerRegistration } from "@/components/staff/service-worker";

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Matches the scanner chrome so the status bar blends in on a mounted device.
  themeColor: "#0a0a0a",
};

export default function ScannerLayout({ children }: LayoutProps<"/scanner">) {
  return (
    <div className="min-h-dvh bg-neutral-950">
      <EnvBanner />
      <ServiceWorkerRegistration />
      {children}
    </div>
  );
}
