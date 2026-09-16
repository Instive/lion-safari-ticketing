"use client";

import { useEffect } from "react";

/**
 * Opens the print dialog by itself for the ticket of a sale that was JUST
 * made, so taking the money and printing is one tap instead of two.
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
 * reach of page code. What this removes is the tap that opens it.
 */
export function AutoPrint() {
  useEffect(() => {
    // Drop the marker before printing, not after: `window.print()` blocks on
    // the dialog in most browsers, and a staff member who reloads while it is
    // open should land on a plain ticket rather than a second dialog.
    const url = new URL(window.location.href);
    url.searchParams.delete("print");
    window.history.replaceState(null, "", url.toString());

    window.print();
  }, []);

  return null;
}
