import type { Metadata } from "next";

import { ServiceWorkerRegistration } from "@/components/staff/service-worker";

/**
 * The counter gets the offline service worker; the admin screens under the same
 * staff shell deliberately do not. Caching a screen full of live totals would
 * only let someone read yesterday's numbers as today's.
 */
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
};

export default function CounterLayout({ children }: LayoutProps<"/counter">) {
  return (
    <>
      <ServiceWorkerRegistration />
      {children}
    </>
  );
}
