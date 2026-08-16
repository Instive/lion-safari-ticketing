import { env } from "@/lib/env";
import { DomainError } from "../errors";

export const MAX_VISITORS_PER_BOOKING = 20;

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
      `A single booking can cover up to ${MAX_VISITORS_PER_BOOKING} visitors. Please make more than one booking.`,
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
