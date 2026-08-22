import { and, eq } from "drizzle-orm";

import { db, type DbOrTx } from "@/db";
import { rateCategories } from "@/db/schema";
import { env } from "@/lib/env";
import { formatPaise } from "@/lib/money";
import { DomainError } from "../errors";

/**
 * Not a policy limit — a group of any realistic size can be sold one ticket.
 * This exists only so a mis-typed count can never push `amount_total` past the
 * 32-bit integer the column stores it in, which would fail as a database error
 * instead of a clear message. At the current fare that ceiling is ~286,000
 * visitors; 10,000 sits far below it and far above any real safari group.
 */
export const MAX_VISITORS_PER_BOOKING = 10_000;

/** A one-off price must be explained, and the explanation is kept forever. */
export const MIN_RATE_NOTE_LENGTH = 3;

export const STANDARD_RATE_LABEL = "Standard";

/**
 * What the counter asked for. Note that CATEGORY carries only an id and CUSTOM
 * is bounded below the standard fare — the browser may influence what a guest
 * is charged, but it can never simply state an amount (spec §4.3).
 */
export type RateSelection =
  | { kind: "STANDARD" }
  | { kind: "CATEGORY"; categoryId: string }
  | { kind: "CUSTOM"; perVisitorPaise: number; note: string };

export type ResolvedRate = {
  perVisitorPaise: number;
  categoryId: string | null;
  label: string;
  note: string | null;
  /** True when this sale was not at the standard fare — the audit-worthy case. */
  concessional: boolean;
};

export const STANDARD_RATE: () => ResolvedRate = () => ({
  perVisitorPaise: env.TICKET_PRICE_PAISE,
  categoryId: null,
  label: STANDARD_RATE_LABEL,
  note: null,
  concessional: false,
});

/**
 * Turns a requested rate into a price, on the server, every time.
 *
 * A named category's price is read from its row — the request supplies only
 * which category, so re-pricing a category later cannot be spoofed and a stale
 * counter screen cannot sell at yesterday's rate. A one-off price is accepted
 * from staff but is capped at the standard fare: concessions exist to charge a
 * guest *less*, and allowing more would turn the counter into a way to
 * overcharge a visitor and pocket the difference.
 */
export async function resolveRate(
  selection: RateSelection | undefined,
  channel: "ONLINE" | "COUNTER",
  tx: DbOrTx = db,
): Promise<ResolvedRate> {
  if (!selection || selection.kind === "STANDARD") return STANDARD_RATE();

  // Concessions are verified in person — a school letter, an ID, a known face.
  // There is nobody on the online channel to check, so it is standard-only.
  if (channel !== "COUNTER") {
    throw new DomainError(
      "RATE_NOT_ALLOWED_ONLINE",
      "Concession rates are available at the ticket counter only.",
    );
  }

  if (selection.kind === "CATEGORY") {
    const [category] = await tx
      .select()
      .from(rateCategories)
      .where(and(eq(rateCategories.id, selection.categoryId), eq(rateCategories.active, true)))
      .limit(1);

    if (!category) {
      throw new DomainError(
        "RATE_NOT_FOUND",
        "That rate is no longer available. Refresh the counter and try again.",
      );
    }

    return {
      perVisitorPaise: category.perVisitorPaise,
      categoryId: category.id,
      label: category.name,
      note: null,
      concessional: category.perVisitorPaise !== env.TICKET_PRICE_PAISE,
    };
  }

  const { perVisitorPaise, note } = selection;

  if (!Number.isInteger(perVisitorPaise) || perVisitorPaise < 0) {
    throw new DomainError("INVALID_RATE", "Enter a price of zero or more.");
  }
  if (perVisitorPaise > env.TICKET_PRICE_PAISE) {
    throw new DomainError(
      "RATE_ABOVE_STANDARD",
      `A special price cannot be more than the standard ${formatPaise(env.TICKET_PRICE_PAISE)} fare.`,
    );
  }
  if (note.trim().length < MIN_RATE_NOTE_LENGTH) {
    throw new DomainError(
      "RATE_NOTE_REQUIRED",
      "Say who this price is for — it is recorded against the sale.",
    );
  }

  return {
    perVisitorPaise,
    categoryId: null,
    label: "Special price",
    note: note.trim().slice(0, 200),
    concessional: perVisitorPaise !== env.TICKET_PRICE_PAISE,
  };
}

export type Quote = {
  visitorCount: number;
  perVisitorPaise: number;
  subtotalPaise: number;
  convenienceFeePaise: number;
  amountTotalPaise: number;
  currency: "INR";
  rate: ResolvedRate;
};

/**
 * The single source of truth for what a booking costs. The browser never sends
 * an amount — it is recomputed here on every create and re-checked against the
 * provider's webhook payload before a booking is marked PAID (spec §4.3).
 */
export function quoteFor(
  visitorCount: number,
  channel: "ONLINE" | "COUNTER",
  rate: ResolvedRate = STANDARD_RATE(),
): Quote {
  if (!Number.isInteger(visitorCount) || visitorCount < 1) {
    throw new DomainError("INVALID_VISITOR_COUNT", "Please choose at least one visitor.");
  }
  if (visitorCount > MAX_VISITORS_PER_BOOKING) {
    throw new DomainError(
      "TOO_MANY_VISITORS",
      `That is more visitors than one booking can hold. Please split it into smaller bookings.`,
    );
  }

  const subtotalPaise = visitorCount * rate.perVisitorPaise;
  // Cash at the counter carries no gateway cost, so no convenience fee.
  const convenienceFeePaise = channel === "ONLINE" ? env.CONVENIENCE_FEE_PAISE : 0;

  return {
    visitorCount,
    perVisitorPaise: rate.perVisitorPaise,
    subtotalPaise,
    convenienceFeePaise,
    amountTotalPaise: subtotalPaise + convenienceFeePaise,
    currency: "INR",
    rate,
  };
}
