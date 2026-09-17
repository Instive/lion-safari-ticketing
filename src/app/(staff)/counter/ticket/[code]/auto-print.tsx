"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * How long the ticket stays on screen after the print dialog closes.
 *
 * Not a cosmetic delay. `onafterprint` fires when the dialog is DISMISSED as
 * well as when it prints, so without a pause, a staff member who cancels to
 * re-read the ticket would be thrown back to a blank sale screen — and the
 * ticket they wanted to check is then several taps away. Three seconds is long
 * enough to notice the countdown and stop it, short enough that a busy counter
 * never waits on it.
 */
const RETURN_AFTER_MS = 3_000;

/**
 * Opens the print dialog by itself for the ticket of a sale that was JUST
 * made, then returns to the sale screen once printing is done — so taking the
 * money, printing and starting the next sale is one tap instead of three.
 *
 * Only ever mounted when the sale redirect asked for it (`?print=1`) and the
 * ticket is ACTIVE — the same page is also the reprint/lookup view, and paper
 * sliding out of the printer because someone opened a ticket to *read* it is
 * worse than the tap this saves. Cancelled and already-used tickets are
 * excluded for the same reason the status banner exists: staff should read
 * what happened before anything is handed over.
 *
 * The browser's print dialog itself cannot be suppressed from here — that is
 * a browser-launch setting (Chrome's --kiosk-printing), deliberately out of
 * reach of page code. What this removes is the taps around it.
 */
export function AutoPrint() {
  const router = useRouter();
  /** Counts down only once the dialog has closed; null means "not yet". */
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    // Drop the marker before printing, not after: `window.print()` blocks on
    // the dialog in most browsers, and a staff member who reloads while it is
    // open should land on a plain ticket rather than a second dialog.
    const url = new URL(window.location.href);
    url.searchParams.delete("print");
    window.history.replaceState(null, "", url.toString());

    // Registered before printing because in some browsers `window.print()`
    // blocks until the dialog closes, which would fire the event before a
    // listener added afterwards could hear it.
    const onAfterPrint = () => setReturning(true);
    window.addEventListener("afterprint", onAfterPrint);

    window.print();

    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, []);

  // Separate from the print effect so cancelling the return does not risk
  // re-running it: this one syncs a timer to `returning`, nothing more.
  useEffect(() => {
    if (!returning) return;
    const timer = setTimeout(() => router.push("/counter"), RETURN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [returning, router]);

  if (!returning) return null;

  return (
    /*
      Pinned above the existing action bar rather than replacing it: "Next sale"
      still works and still goes straight there, so nobody has to wait for a
      countdown they can simply tap past.
    */
    <div className="no-print fixed inset-x-0 bottom-24 z-20 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-lg">
        <p className="text-sm font-medium">Returning to the sale screen…</p>
        <button
          type="button"
          onClick={() => setReturning(false)}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-background"
        >
          Stay here
        </button>
      </div>
    </div>
  );
}
