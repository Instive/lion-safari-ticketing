"use client";

import { useEffect, useRef, useState } from "react";

import { TicketCard } from "@/components/ticket-card";
import {
  deviceCalendarDate,
  formatCalendarDate,
  formatDeviceDateTime,
  formatDeviceTime,
} from "@/lib/format-date";
import { renderQrDataUrl } from "@/lib/qr";

export type OfflineTicketData = {
  bookingCode: string;
  token: string;
  visitorCount: number;
  visitDate: string;
  amountTotal: number;
  issuedAt: Date;
  customerName: string | null;
};

/**
 * The ticket just sold from the local book, ready to hand over.
 *
 * The QR is generated here in the browser through the very same
 * `renderQrDataUrl` the server uses, so an offline ticket is not a lookalike —
 * it is the identical artefact, down to the error-correction level that keeps
 * it readable on thermal paper.
 */
/** Matches the online ticket screen — see auto-print.tsx for why there is a pause. */
const RETURN_AFTER_MS = 3_000;

export function OfflineTicket({
  ticket,
  isTest,
  onDone,
}: {
  ticket: OfflineTicketData;
  /** Read from APP_ENV on the server and handed down — see TicketCardData.isTest. */
  isTest: boolean;
  onDone: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);
  // Guards the one-shot auto-print below. A ref, not state: firing the dialog
  // is a side effect that must happen exactly once, and re-rendering because
  // it happened would be pointless.
  const printed = useRef(false);
  /** True once the print dialog has closed and the return is counting down. */
  const [returning, setReturning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    renderQrDataUrl(ticket.token)
      .then((dataUrl) => {
        if (!cancelled) setQr(dataUrl);
      })
      .catch((err) => console.error("[counter] could not render offline QR", err));
    return () => {
      cancelled = true;
    };
  }, [ticket.token]);

  /*
    Opens the print dialog once the ticket is actually printable, then clears
    back to a fresh sale when it closes — matching the online sale screen so
    staff read one flow rather than two.

    Waiting on `qr` is the whole point of doing this separately from the online
    version: there the QR arrives server-rendered with the page, but here it is
    generated in the browser, and printing before it resolves would hand a
    guest a ticket with an empty box where the scannable part should be. An
    offline sale is exactly when nobody can recover that at the gate.
  */
  useEffect(() => {
    if (!qr || printed.current) return;
    printed.current = true;

    // Registered before printing: `window.print()` blocks until the dialog
    // closes in some browsers, which would fire this before a listener added
    // afterwards could hear it.
    const onAfterPrint = () => setReturning(true);
    window.addEventListener("afterprint", onAfterPrint);
    window.print();
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, [qr]);

  // `onDone` already clears the form back to a fresh sale, so returning is
  // just calling it — there is no route to push here, the ticket is an overlay.
  useEffect(() => {
    if (!returning) return;
    const timer = setTimeout(onDone, RETURN_AFTER_MS);
    return () => clearTimeout(timer);
  }, [returning, onDone]);

  return (
    /*
      The overlay itself is left exactly as it was — `fixed inset-0` with the
      scrolling on the outer element — because that is what prints correctly on
      the thermal roll today. The layout changes are all inside it.
    */
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-4 print:block print:min-h-0">
        {/* Same three-column arrangement as the online ticket screen, empty
            third column included: it is what keeps the ticket centred instead
            of pushed right by the panel beside it. Staff should not have to
            read two different screens for what is, to them, one job. */}
        <div className="flex flex-1 flex-col gap-5 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:items-start lg:gap-6">
          <div className="no-print rounded-xl border border-accent/40 bg-accent/5 px-4 py-3 lg:col-start-1 lg:max-w-72 lg:justify-self-end">
            <p className="font-semibold text-accent">Ticket ready — sold offline</p>
            <p className="text-muted text-sm">
              Hand this to the guest. It scans at the gate now; the sale reaches the office by
              itself once the connection returns.
            </p>
          </div>

          <div className="mx-auto w-full max-w-md lg:col-start-2">
            {qr ? (
              <TicketCard
                ticket={{
                  bookingCode: ticket.bookingCode,
                  status: "ACTIVE",
                  visitorCount: ticket.visitorCount,
                  amountTotal: ticket.amountTotal,
                  visitDateLabel: formatCalendarDate(ticket.visitDate),
                  issuedLabel: formatDeviceDateTime(ticket.issuedAt),
                  issuedTimeLabel:
                    deviceCalendarDate(ticket.issuedAt) === ticket.visitDate
                      ? formatDeviceTime(ticket.issuedAt)
                      : null,
                  customerName: ticket.customerName,
                  isTest,
                }}
                qrDataUrl={qr}
              />
            ) : (
              <p className="text-muted py-16 text-center">Preparing ticket…</p>
            )}
          </div>
        </div>

        {/* Pinned, exactly as on the online ticket screen. */}
        <div className="no-print sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-background/95 px-4 pb-4 pt-3 backdrop-blur">
          <div className="mx-auto grid max-w-md grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => window.print()}
              disabled={!qr}
              className="min-h-14 rounded-xl border border-line bg-surface px-4 font-semibold hover:bg-background disabled:opacity-60"
            >
              Print
            </button>
            <button
              type="button"
              onClick={onDone}
              className="min-h-14 rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-strong"
            >
              Next sale
            </button>
          </div>

          {/* Same countdown as the online ticket screen: the dialog closing is
              not proof the ticket was printed — it may have been dismissed —
              so there is always a way to stay and look at it. */}
          {returning ? (
            <div className="mx-auto mt-3 flex max-w-md justify-center">
              <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2">
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
