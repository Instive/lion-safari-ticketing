import Image from "next/image";

import { formatPaise } from "@/lib/money";
import type { TicketStatus } from "@/db/schema";

export type TicketCardData = {
  bookingCode: string;
  status: TicketStatus;
  visitorCount: number;
  amountTotal: number;
  /**
   * Dates arrive already formatted, and deliberately so: turning them into text
   * needs the park's timezone, which lives in `@/lib/env` and must never be
   * imported by a Client Component — doing so drags the server's environment
   * validation into the browser, where it throws on the first render. The
   * server formats in park time; the offline counter formats on the device
   * clock, which is the only clock it has.
   */
  visitDateLabel: string;
  issuedLabel: string;
  /**
   * The time alone, set only when the ticket was issued on the day it is valid
   * for — which at the counter is every ticket.
   *
   * Then there is one date on the paper instead of two saying the same thing,
   * with the time appended to it, because the time is what staff and guests
   * actually read off a same-day ticket. An advance online booking leaves this
   * null and keeps both rows: there the visit date and the purchase date are
   * genuinely different facts and collapsing them would lose one.
   */
  issuedTimeLabel?: string | null;
  customerName?: string | null;
};

const statusCopy: Record<TicketStatus, { label: string; note: string }> = {
  ACTIVE: { label: "Valid", note: "Show this QR code at the safari boarding gate." },
  USED: { label: "Already used", note: "This ticket has been used for boarding." },
  CANCELLED: { label: "Cancelled", note: "This ticket was cancelled and cannot be used." },
  EXPIRED: { label: "Expired", note: "This ticket is no longer valid." },
};

const TERMS = [
  "Ticket is valid only for the date and time mentioned.",
  "Non-transferable, non-refundable and valid for one-time entry only.",
  "Please follow the rules and instructions for a safe and enjoyable safari.",
];

/**
 * The ticket itself — pure markup, no data fetching and no async work.
 *
 * Split out from `TicketView` so the counter can render an identical ticket
 * from its local ticket book while the internet is down: the offline path
 * generates the QR in the browser and passes it in as `qrDataUrl`, and gets
 * byte-for-byte the same layout the server produces. A ticket printed during an
 * outage must be indistinguishable from any other, or staff and guests start
 * treating it as second class.
 *
 * Print is an 80mm thermal roll (see the `.ticket` rules in globals.css), so
 * everything here has to survive being 72mm wide and monochrome. Two things
 * follow: the QR is sized in millimetres rather than pixels for print, and the
 * status badge is screen-only — a "Valid" stamp on paper says what the ticket
 * said when it was printed, not now, and on a cancelled ticket it would be
 * actively misleading.
 */
export function TicketCard({
  ticket,
  qrDataUrl,
}: {
  ticket: TicketCardData;
  qrDataUrl: string;
}) {
  const copy = statusCopy[ticket.status];
  const usable = ticket.status === "ACTIVE";

  return (
    <article className="ticket mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-surface print:rounded-none">
      <header className="flex items-center justify-center gap-3 px-3 pb-2.5 pt-3">
        {/*
          `unoptimized`, and pointing at a pre-sized file, on purpose. The
          optimizer serves images from /_next/image, which needs the network —
          so an optimized image is a broken image on a ticket sold during an
          outage. These are plain URLs the service worker precaches instead.
        */}
        <Image
          src="/ticket-lion.png"
          alt=""
          width={44}
          height={54}
          unoptimized
          className="ticket-animal h-11 w-auto shrink-0"
        />
        <div className="min-w-0 text-center leading-tight">
          <h1 className="font-display text-2xl tracking-wide text-brand">M.C.Z.P Chhatbir</h1>
          <p className="text-muted text-[9px] uppercase tracking-[0.3em]">Wildlife Safari</p>
        </div>
        <Image
          src="/ticket-deer.png"
          alt=""
          width={46}
          height={54}
          unoptimized
          className="ticket-animal h-11 w-auto shrink-0"
        />
      </header>

      <Perforation />

      {/* The scan target, front and centre. */}
      <div className="px-4 pb-3 pt-3 text-center">
        <p className="mx-auto inline-block rounded-full bg-brand px-3 py-1 text-[9px] font-bold uppercase tracking-[0.2em] text-white print:border print:border-black print:bg-white print:text-black">
          Scan at the gate
        </p>

        {/* No frame around the code — the white padding is kept because it is
            the QR's quiet zone, which scanners need. */}
        <div className="mx-auto mt-2.5 inline-block bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed */}
          <img
            src={qrDataUrl}
            alt={`QR code for booking ${ticket.bookingCode}`}
            width={200}
            height={200}
            className={`ticket-qr h-auto w-[min(200px,54vw)] ${usable ? "" : "opacity-25"}`}
          />
        </div>

        <p className="text-muted mt-2.5 text-[9px] uppercase tracking-[0.2em]">
          Ticket no.{" "}
          <span className="text-foreground font-mono text-[11px] font-semibold tracking-[0.12em]">
            {ticket.bookingCode}
          </span>
        </p>

        <p className={`no-print mt-2.5 text-sm font-bold ${usable ? "text-ok" : "text-danger"}`}>
          {copy.label}
        </p>
        <p className="text-muted mt-1.5 text-[11px] leading-snug">{copy.note}</p>
      </div>

      <Perforation />

      <dl className="px-4 py-2.5 text-sm">
        <Row
          label="Date"
          value={
            ticket.issuedTimeLabel
              ? `${ticket.visitDateLabel} · ${ticket.issuedTimeLabel}`
              : ticket.visitDateLabel
          }
        />
        <Row label="Visitors" value={`${ticket.visitorCount}`} strong />
        {ticket.issuedTimeLabel ? null : <Row label="Issued" value={ticket.issuedLabel} />}
        {ticket.customerName ? <Row label="Name" value={ticket.customerName} /> : null}
        <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t-2 border-double border-line pt-2">
          <dt className="text-[11px] font-semibold uppercase tracking-[0.16em]">Amount paid</dt>
          <dd className="text-lg font-bold tabular-nums">{formatPaise(ticket.amountTotal)}</dd>
        </div>
      </dl>

      <Perforation />

      <footer className="px-4 pb-3 pt-2.5">
        <p className="text-muted text-[9px] font-semibold uppercase tracking-[0.16em]">
          Terms &amp; conditions
        </p>
        <ul className="text-muted mt-1 space-y-0.5 text-[9.5px] leading-snug">
          {TERMS.map((term) => (
            <li key={term} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span>{term}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-center font-script text-xl leading-none text-brand">
          Thank You &amp; Visit Again!
        </p>
      </footer>
    </article>
  );
}

/** Dashed rule between the ticket's sections — reads as a tear-off line. */
function Perforation() {
  return <div className="border-t border-dashed border-line" aria-hidden />;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="ticket-row flex items-baseline justify-between gap-3 border-b border-dotted border-line py-1 last-of-type:border-0">
      <dt className="text-muted shrink-0 text-[11px] uppercase tracking-[0.12em]">{label}</dt>
      <dd className={`text-right ${strong ? "text-base font-bold" : "text-[13px] font-medium"}`}>
        {value}
      </dd>
    </div>
  );
}
