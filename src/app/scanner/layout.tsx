import type { Viewport } from "next";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Matches the scanner chrome so the status bar blends in on a mounted device.
  themeColor: "#0a0a0a",
};

export default function ScannerLayout({ children }: LayoutProps<"/scanner">) {
  return <div className="min-h-dvh bg-neutral-950">{children}</div>;
}
