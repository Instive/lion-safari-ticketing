"use client";

import { useEffect } from "react";

/**
 * Holds a screen wake lock while the scanner is on.
 *
 * A gate tablet whose screen has gone to sleep is indistinguishable from a
 * broken scanner to the person holding it, and waking it costs a queue. The
 * lock is dropped by the browser whenever the page is hidden, so it has to be
 * taken again every time the tab becomes visible — releasing it once on unmount
 * is not enough.
 *
 * Unsupported browsers simply do nothing; the scanner works either way.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Denied (low battery, unsupported surface) — not worth a message.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}
