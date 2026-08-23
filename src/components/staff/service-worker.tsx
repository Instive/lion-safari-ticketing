"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker for the counter and scanner.
 *
 * Rendered only by those two layouts, never by admin: the worker's scope is the
 * whole origin, but nothing should be caching a screen where a stale number
 * could be mistaken for a current one.
 *
 * Registration is skipped in development — an aggressively cached shell and a
 * hot-reloading dev server fight each other, and the resulting stale-chunk
 * errors look like application bugs.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((err) => console.warn("[sw] registration failed", err));
    };

    // After load, so fetching the worker never competes with the first paint on
    // a slow tablet.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
