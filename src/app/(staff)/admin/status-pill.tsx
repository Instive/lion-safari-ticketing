import type { BookingStatus, TicketStatus } from "@/db/schema";

const tone: Record<BookingStatus, string> = {
  PAID: "bg-ok/10 text-ok",
  CASH_CONFIRMED: "bg-ok/10 text-ok",
  PENDING: "bg-accent/10 text-accent",
  REFUND_PENDING: "bg-accent/10 text-accent",
  FAILED: "bg-danger/10 text-danger",
  CANCELLED: "bg-danger/10 text-danger",
  REFUNDED: "bg-danger/10 text-danger",
};

const label: Record<BookingStatus, string> = {
  PAID: "Paid",
  CASH_CONFIRMED: "Cash paid",
  PENDING: "Awaiting payment",
  REFUND_PENDING: "Refund in progress",
  FAILED: "Payment failed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
};

export function StatusPill({
  status,
  ticketStatus,
}: {
  status: BookingStatus;
  ticketStatus?: TicketStatus | null;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${tone[status]}`}>
        {label[status]}
      </span>
      {ticketStatus === "USED" ? (
        <span className="rounded-lg bg-brand/10 px-2 py-1 text-xs font-semibold text-brand">
          Boarded
        </span>
      ) : null}
    </span>
  );
}
