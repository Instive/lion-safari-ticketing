import { isTestEnvironment } from "@/components/staff/env-banner";
import { renderQrDataUrl } from "@/lib/qr";
import { businessDate, formatClockTime, formatDateTime, formatVisitDate } from "@/lib/time";
import type { TicketStatus } from "@/db/schema";
import { TicketCard } from "./ticket-card";

export type TicketViewData = {
  bookingCode: string;
  /** The raw token, encoded into the QR. Never leaves the server as anything else. */
  token: string;
  status: TicketStatus;
  visitorCount: number;
  visitDate: string;
  amountTotal: number;
  /**
   * When the ticket was issued, from the server clock — the counter prints this
   * so a paper ticket carries its own time of sale (spec §6: device clocks are
   * never the source).
   */
  issuedAt: Date;
  customerName?: string | null;
};

/**
 * The ticket, as shown on a customer's phone and as printed at the counter.
 *
 * Renders the QR and formats the dates in the park's timezone, then hands the
 * result to `TicketCard` — which is also what the counter uses to print offline
 * from its ticket book, so a ticket sold during an outage is identical to every
 * other one.
 */
export async function TicketView({ ticket }: { ticket: TicketViewData }) {
  const qr = await renderQrDataUrl(ticket.token);
  // Both dates are compared in park time, so a ticket sold at 11pm IST is still
  // "today" rather than tomorrow's UTC date.
  const issuedOnVisitDay = businessDate(ticket.issuedAt) === ticket.visitDate;

  return (
    <TicketCard
      ticket={{
        bookingCode: ticket.bookingCode,
        status: ticket.status,
        visitorCount: ticket.visitorCount,
        amountTotal: ticket.amountTotal,
        visitDateLabel: formatVisitDate(ticket.visitDate),
        issuedLabel: formatDateTime(ticket.issuedAt),
        issuedTimeLabel: issuedOnVisitDay ? formatClockTime(ticket.issuedAt) : null,
        customerName: ticket.customerName,
        isTest: isTestEnvironment(),
      }}
      qrDataUrl={qr}
    />
  );
}
