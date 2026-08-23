"use client";

/**
 * Connectivity as an external store, so components read it through
 * `useSyncExternalStore` and render stays pure.
 *
 * Shared by the gate scanner and the counter — both have to know when the link
 * comes back so they can drain their outbox immediately rather than waiting for
 * the next poll.
 *
 * `navigator.onLine` only proves a network interface exists, not that our server
 * is reachable; a captive portal or a dead uplink still reads as "online". It is
 * a hint for when to *try*, never a claim that a request will succeed — which is
 * why every sync path here still handles failure on its own terms.
 */
export function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function getOnlineSnapshot(): boolean {
  return navigator.onLine;
}

/** The server has no connectivity state; assume online so SSR markup matches. */
export function getOnlineServerSnapshot(): boolean {
  return true;
}
