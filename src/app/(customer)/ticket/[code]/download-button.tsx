"use client";

/**
 * Saves the ticket as a PDF, via the browser's own print dialog.
 *
 * Deliberately not a generated-PDF download: the print stylesheet in
 * globals.css already lays the ticket out for paper (and for the counter's
 * 80mm roll), so "Save as PDF" in that dialog produces the same ticket the
 * counter prints, with no PDF library added to the bundle. Every current
 * browser offers a PDF destination — on iOS Safari it is the Share sheet's
 * "Print", which also saves — so the wording says what the guest is trying to
 * do rather than naming one platform's menu item.
 */
export function DownloadTicketButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="touch-target no-print w-full rounded-xl border border-brand px-4 font-semibold text-brand hover:bg-brand hover:text-white"
    >
      Download / print ticket
    </button>
  );
}
