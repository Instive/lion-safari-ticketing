"use client";

import { useEffect, useState } from "react";

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
export function OfflineTicket({
  ticket,
  onDone,
}: {
  ticket: OfflineTicketData;
  onDone: () => void;
}) {
  const [qr, setQr] = useState<string | null>(null);

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

  return (
    /*
      The overlay itself is left exactly as it was — `fixed inset-0` with the
      scrolling on the outer element — because that is what prints correctly on
      the thermal roll today. The layout changes are all inside it.
    */
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-4 print:block print:min-h-0">
        {/* Status beside the ticket on a wide counter display, above it on a
            narrow one — the same arrangement as the online ticket screen, since
            staff should not have to read two different layouts for what is, to
            them, one job. */}
        <div className="flex flex-1 flex-col gap-5 lg:grid lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          <div className="no-print rounded-xl border border-accent/40 bg-accent/5 px-4 py-3">
            <p className="font-semibold text-accent">Ticket ready — sold offline</p>
            <p className="text-muted text-sm">
              Hand this to the guest. It scans at the gate now; the sale reaches the office by
              itself once the connection returns.
            </p>
          </div>

          <div className="mx-auto w-full max-w-md">
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
                }}
                qrDataUrl={qr}
              />
            ) : (
              <p className="text-muted py-16 text-center">Preparing ticket…</p>
            )}
          </div>
        </div>

        <div className="no-print sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-background/95 px-4 pb-4 pt-3 backdrop-blur">
          <div className="grid grid-cols-2 gap-3">
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
        </div>
      </div>
    </div>
  );
}
