import { renderQrDataUrl } from "@/lib/qr";
import { formatPaise } from "@/lib/money";
import { formatVisitDate } from "@/lib/time";
import { env } from "@/lib/env";
import type { TicketStatus } from "@/db/schema";

export type TicketViewData = {
  bookingCode: string;
  token: string;
  status: TicketStatus;
  visitorCount: number;
  visitDate: string;
  amountTotal: number;
  customerName?: string | null;
};

const statusCopy: Record<TicketStatus, { label: string; note: string }> = {
  ACTIVE: { label: "Valid", note: "Show this QR code at the safari boarding gate." },
  USED: { label: "Already used", note: "This ticket has been used for boarding." },
  CANCELLED: { label: "Cancelled", note: "This ticket was cancelled and cannot be used." },
  EXPIRED: { label: "Expired", note: "This ticket is no longer valid." },
};

/**
 * The ticket, as shown on a customer's phone and as printed at the counter.
 * Same component for both so a reprint can never differ from the original.
 */
export async function TicketView({ ticket }: { ticket: TicketViewData }) {
  const qr = await renderQrDataUrl(ticket.token);
  const copy = statusCopy[ticket.status];
  const usable = ticket.status === "ACTIVE";

  return (
    <article className="mx-auto w-full max-w-sm rounded-xl border border-line bg-surface p-6 print:border-black">
      <header className="text-center">
        <h1 className="font-display text-2xl tracking-wide text-brand">Chhatbir Zoo</h1>
        <p className="text-muted text-xs uppercase tracking-wide">Lion &amp; Deer Safari — Entry ticket</p>
      </header>

      <div className="my-5 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URI, no loader needed */}
        <img
          src={qr}
          alt={`QR code for booking ${ticket.bookingCode}`}
          width={220}
          height={220}
          className={usable ? "" : "opacity-30"}
        />
      </div>

      <p className="text-center font-mono text-xl font-bold tracking-widest">
        {ticket.bookingCode}
      </p>

      <p
        className={`mt-2 text-center text-sm font-semibold ${
          usable ? "text-ok" : "text-danger"
        }`}
      >
        {copy.label}
      </p>
      <p className="text-muted mt-1 text-center text-xs">{copy.note}</p>

      <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
        <Row label="Visit date" value={formatVisitDate(ticket.visitDate)} />
        <Row label="Visitors" value={`${ticket.visitorCount}`} strong />
        <Row label="Amount paid" value={formatPaise(ticket.amountTotal)} />
        {ticket.customerName ? <Row label="Name" value={ticket.customerName} /> : null}
      </dl>

      <footer className="text-muted mt-5 border-t border-line pt-4 text-center text-[11px] leading-relaxed">
        <p>The whole group must board together with this ticket.</p>
        {env.SUPPORT_PHONE ? <p>Lost your ticket? Call {env.SUPPORT_PHONE}</p> : null}
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
