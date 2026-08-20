import Image from "next/image";

import { renderQrDataUrl } from "@/lib/qr";
import { formatPaise } from "@/lib/money";
import { formatDateTime, formatVisitDate } from "@/lib/time";
import type { TicketStatus } from "@/db/schema";

export type TicketViewData = {
  bookingCode: string;
  token: string;
  status: TicketStatus;
  visitorCount: number;
  visitDate: string;
  amountTotal: number;
  /**
   * When the ticket was issued, from the server clock — the counter prints
   * this so a paper ticket carries its own time of sale (spec §6: device
   * clocks are never the source).
   */
  issuedAt: Date;
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
 * The ticket, as shown on a customer's phone and as printed at the counter.
 * Same component for both so a reprint can never differ from the original.
 *
 * Print is an 80mm thermal roll (see the `.ticket` rules in globals.css), so
 * everything here has to survive being 72mm wide and monochrome. Two things
 * follow from that: the QR is sized in millimetres rather than pixels for
 * print, and the status badge is screen-only — a "Valid" stamp on paper is
 * worthless (it says what the ticket said when it was printed, not now) and
 * on a cancelled ticket it would be actively misleading. Staff read the
 * status off the screen, where it is live.
 */
export async function TicketView({ ticket }: { ticket: TicketViewData }) {
  const qr = await renderQrDataUrl(ticket.token);
  const copy = statusCopy[ticket.status];
  const usable = ticket.status === "ACTIVE";

  return (
    <article className="ticket mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-surface print:rounded-none">
      <header className="flex items-center justify-center gap-3 px-3 pb-2.5 pt-3">
        <Image
          src="/lion-transparent-opt.png"
          alt=""
          width={44}
          height={54}
          className="ticket-animal h-11 w-auto shrink-0"
        />
        <div className="min-w-0 text-center leading-tight">
          <h1 className="font-display text-2xl tracking-wide text-brand">M.C.Z.P Chhatbir</h1>
          <p className="text-muted text-[9px] uppercase tracking-[0.3em]">Wildlife Safari</p>
        </div>
        <Image
          src="/deer-transparent-opt.png"
          alt=""
          width={46}
          height={54}
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
            src={qr}
            alt={`QR code for booking ${ticket.bookingCode}`}
            width={200}
            height={200}
            className={`ticket-qr h-auto w-[min(200px,54vw)] ${usable ? "" : "opacity-25"}`}
          />
        </div>

        <p className="text-muted mt-2 text-[9px] uppercase tracking-[0.22em]">Ticket no.</p>
        <p className="font-mono text-sm font-semibold tracking-[0.2em]">{ticket.bookingCode}</p>

        <p className={`no-print mt-2.5 text-sm font-bold ${usable ? "text-ok" : "text-danger"}`}>
          {copy.label}
        </p>
        <p className="text-muted mt-1.5 text-[11px] leading-snug">{copy.note}</p>
      </div>

      <Perforation />

      <dl className="px-4 py-2.5 text-sm">
        <Row label="Date" value={formatVisitDate(ticket.visitDate)} />
        <Row label="Visitors" value={`${ticket.visitorCount}`} strong />
        <Row label="Issued" value={formatDateTime(ticket.issuedAt)} />
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
