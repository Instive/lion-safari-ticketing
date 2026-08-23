import { renderQrDataUrl } from "@/lib/qr";
import { TicketCard, type TicketCardData } from "./ticket-card";

export type TicketViewData = TicketCardData & {
  /** The raw token, encoded into the QR. Never leaves the server as anything else. */
  token: string;
};

/**
 * The ticket, as shown on a customer's phone and as printed at the counter.
 *
 * Renders the QR on the server and hands the finished markup to `TicketCard`,
 * which is also what the counter uses to print offline from its ticket book —
 * so a ticket sold during an outage is identical to every other one.
 */
export async function TicketView({ ticket }: { ticket: TicketViewData }) {
  const qr = await renderQrDataUrl(ticket.token);
  return <TicketCard ticket={ticket} qrDataUrl={qr} />;
}
