import { env } from "@/lib/env";
import { DomainError } from "../errors";

/**
 * Not a policy limit — a group of any realistic size can be sold one ticket.
 * This exists only so a mis-typed count can never push `amount_total` past the
 * 32-bit integer the column stores it in, which would fail as a database error
 * instead of a clear message. At the current fare that ceiling is ~286,000
 * visitors; 10,000 sits far below it and far above any real safari group.
 */
export const MAX_VISITORS_PER_BOOKING = 10_000;

export type Quote = {
  visitorCount: number;
  perVisitorPaise: number;
  subtotalPaise: number;
  convenienceFeePaise: number;
  amountTotalPaise: number;
  currency: "INR";
};

/**
 * The single source of truth for what a booking costs. The browser never sends
 * an amount — it is recomputed here on every create and re-checked against the
 * provider's webhook payload before a booking is marked PAID (spec §4.3).
 */
export function quoteFor(visitorCount: number, channel: "ONLINE" | "COUNTER"): Quote {
  if (!Number.isInteger(visitorCount) || visitorCount < 1) {
    throw new DomainError("INVALID_VISITOR_COUNT", "Please choose at least one visitor.");
  }
  if (visitorCount > MAX_VISITORS_PER_BOOKING) {
    throw new DomainError(
      "TOO_MANY_VISITORS",
      `That is more visitors than one booking can hold. Please split it into smaller bookings.`,
    );
  }

  const subtotalPaise = visitorCount * env.TICKET_PRICE_PAISE;
  // Cash at the counter carries no gateway cost, so no convenience fee.
  const convenienceFeePaise = channel === "ONLINE" ? env.CONVENIENCE_FEE_PAISE : 0;

  return {
    visitorCount,
    perVisitorPaise: env.TICKET_PRICE_PAISE,
    subtotalPaise,
    convenienceFeePaise,
    amountTotalPaise: subtotalPaise + convenienceFeePaise,
    currency: "INR",
  };
}
