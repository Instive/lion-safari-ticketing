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
      <header className="flex items-center justify-center gap-3 border-b border-line px-3 py-3">
        <Image
          src="/lion-transparent-opt.png"
          alt=""
          width={44}
          height={54}
          className="ticket-animal h-12 w-auto shrink-0"
        />
        <div className="min-w-0 text-center leading-tight">
          <h1 className="font-display text-2xl tracking-wide text-brand">M.C.Z.P Chhatbir</h1>
          <p className="text-muted text-[10px] uppercase tracking-[0.28em]">
            — Wildlife Safari —
          </p>
        </div>
        <Image
          src="/deer-transparent-opt.png"
          alt=""
          width={46}
          height={54}
          className="ticket-animal h-12 w-auto shrink-0"
        />
      </header>

      {/* The scan target, front and centre. */}
      <div className="px-4 pb-4 pt-4 text-center">
        <div className="mx-auto inline-block rounded-xl border border-line bg-white p-2.5 print:rounded-none">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed */}
          <img
            src={qr}
            alt={`QR code for booking ${ticket.bookingCode}`}
            width={220}
            height={220}
            className={`ticket-qr h-auto w-[min(220px,58vw)] ${usable ? "" : "opacity-25"}`}
          />
        </div>

        <p className={`no-print mt-3 text-base font-bold ${usable ? "text-ok" : "text-danger"}`}>
          {copy.label}
        </p>
        <p className="text-muted mt-1 text-xs print:mt-2">{copy.note}</p>
        <p className="text-muted mt-2 text-[11px] uppercase tracking-wide">
          Ticket no.{" "}
          <span className="font-mono tracking-widest text-foreground">{ticket.bookingCode}</span>
        </p>
      </div>

      <dl className="space-y-1.5 border-t border-line px-4 py-3 text-sm">
        <Row label="Date" value={formatVisitDate(ticket.visitDate)} />
        <Row label="Visitors" value={`${ticket.visitorCount}`} strong />
        <Row label="Issued" value={formatDateTime(ticket.issuedAt)} />
        {ticket.customerName ? <Row label="Name" value={ticket.customerName} /> : null}
      </dl>

      <p className="flex items-center justify-between gap-4 bg-brand px-4 py-2.5 text-white print:border-y print:border-black print:bg-white print:text-black">
        <span className="text-xs font-semibold uppercase tracking-[0.18em]">Total fare</span>
        <span className="text-2xl font-bold tabular-nums">{formatPaise(ticket.amountTotal)}</span>
      </p>

      <footer className="text-muted border-t border-line px-4 py-3 text-[10px] leading-relaxed">
        <p className="font-semibold uppercase tracking-wide">Terms &amp; conditions</p>
        <ul className="mt-1 space-y-0.5">
          {TERMS.map((term) => (
            <li key={term} className="flex gap-1.5">
              <span aria-hidden>•</span>
              <span>{term}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-center text-xs font-semibold text-brand">
          Thank You &amp; Visit Again!
        </p>
      </footer>
    </article>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={strong ? "text-lg font-bold" : "font-medium"}>{value}</dd>
    </div>
  );
}
