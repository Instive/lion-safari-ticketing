"use client";

import { useEffect, useState } from "react";

import { TicketCard } from "@/components/ticket-card";
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background p-4">
      <div className="mx-auto w-full max-w-md">
        <div className="no-print mb-4 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3">
          <p className="font-semibold text-accent">Ticket ready — sold offline</p>
          <p className="text-muted text-sm">
            Hand this to the guest. It scans at the gate now; the sale reaches the office by
            itself once the connection returns.
          </p>
        </div>

        {qr ? (
          <TicketCard
            ticket={{
              bookingCode: ticket.bookingCode,
              status: "ACTIVE",
              visitorCount: ticket.visitorCount,
              visitDate: ticket.visitDate,
              amountTotal: ticket.amountTotal,
              issuedAt: ticket.issuedAt,
              customerName: ticket.customerName,
            }}
            qrDataUrl={qr}
          />
        ) : (
          <p className="text-muted py-16 text-center">Preparing ticket…</p>
        )}

        <div className="no-print mt-5 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!qr}
            className="touch-target rounded-xl border border-line bg-surface px-4 font-semibold hover:bg-background disabled:opacity-60"
          >
            Print
          </button>
          <button
            type="button"
            onClick={onDone}
            className="touch-target rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-strong"
          >
            Next sale
          </button>
        </div>
      </div>
    </div>
  );
}
