import type { Viewport } from "next";

import { EnvBanner } from "@/components/staff/env-banner";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

/**
 * The root layout pins the viewport at `maximumScale: 1` because the scanner
 * and counter are fixed-layout tools. The public site is a document, not a
 * tool, and a public-sector site must let visitors pinch-zoom it (WCAG 1.4.4),
 * so this segment overrides that.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export default function CustomerLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      {/* The riskiest page in a test deployment is this one: the public site
          carries the park's name, its real prices and a working booking form.
          noindex keeps it out of search; this tells anyone who reaches it
          another way. */}
      <EnvBanner />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <div id="main-content" tabIndex={-1} className="flex-1 bg-background">
        {children}
      </div>
      <SiteFooter />
    </>
  );
}
