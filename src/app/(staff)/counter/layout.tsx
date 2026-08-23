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
      {/*
        The ticket artwork is fetched now, while there is a connection, because
        the moment it is actually needed is the moment there is not: a ticket
        printed during an outage. The service worker precaches it too — this
        covers the window before a worker has installed.
      */}
      <link rel="preload" as="image" href="/ticket-lion.png" />
      <link rel="preload" as="image" href="/ticket-deer.png" />
      <ServiceWorkerRegistration />
      {children}
    </>
  );
}
