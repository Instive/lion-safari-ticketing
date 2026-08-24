import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, rateCategories, type BookingStatus } from "@/db/schema";

export type CounterSale = {
  bookingCode: string;
  visitorCount: number;
  amountTotal: number;
  status: BookingStatus;
  /** When the cash was taken — not necessarily when the row was created. */
  soldAt: Date;
  soldOffline: boolean;
};

/**
 * When a counter sale actually happened.
 *
 * For an ordinary sale that is when the booking was created. For one sold
 * during an outage it is emphatically not: the row was minted in advance as a
 * blank in the till's ticket book, up to `BOOK_HORIZON_DAYS` before anyone paid
 * for it, so its `created_at` is the moment the book was allocated.
 *
 * The till's own clock is the only record of the real moment, and it stays
 * audit-only everywhere it counts (spec §6) — nothing downstream of this decides
 * validity, money or admissibility. It orders a list and prints a time beside
 * it, and those rows are labelled offline so a skewed device clock reads as a
 * device clock rather than as fact.
 */
const soldAt = sql<Date>`coalesce(${bookings.soldOfflineAt}, ${bookings.createdAt})`;

/**
 * The last few sales one staff member made today, most recent first.
 *
 * This is how an unsure staff member answers "did my last sale actually go
 * through" without leaving the screen — which is exactly why ordering by
 * `created_at` was wrong. It sorted every offline sale behind every online one
 * and pushed it off the end of the list, so the sales staff had most reason to
 * doubt were the only ones they could not see.
 */
export async function recentCounterSales(
  staffId: string,
  visitDate: string,
  limit = 5,
): Promise<CounterSale[]> {
  return db
    .select({
      bookingCode: bookings.bookingCode,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      status: bookings.status,
      soldAt,
      soldOffline: sql<boolean>`${bookings.soldOfflineAt} is not null`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.channel, "COUNTER"),
        eq(bookings.createdByStaffId, staffId),
        eq(bookings.visitDate, visitDate),
      ),
    )
    .orderBy(desc(soldAt))
    .limit(limit);
}

export type TenderTotals = { sales: number; visitors: number; amount: number };

export type DayEndSummary = {
  cash: TenderTotals;
  upi: TenderTotals;
  total: TenderTotals;
  /** Sales this staff member cancelled today — the drawer has to account for these. */
  cancelled: { sales: number; amount: number };
  /** What was sold at each fare, so a short total has a visible explanation. */
  byRate: { label: string; sales: number; visitors: number; amount: number }[];
  firstSaleAt: Date | null;
  lastSaleAt: Date | null;
};

/**
 * One staff member's takings for one day, for the slip they print at handover.
 *
 * Split by tender because the two are reconciled against different things: cash
 * against what is physically in the drawer, UPI against the account statement.
 * A single combined figure can only be checked against the sum of two documents
 * nobody has side by side.
 *
 * Cancellations are reported rather than merely excluded. A drawer that is
 * short by exactly one ticket is a very different conversation from one that is
 * short for no visible reason, and the person handing over is the one who can
 * still explain it.
 */
export async function dayEndSummary(staffId: string, visitDate: string): Promise<DayEndSummary> {
  const mine = and(
    eq(bookings.channel, "COUNTER"),
    eq(bookings.createdByStaffId, staffId),
    eq(bookings.visitDate, visitDate),
  );

  const confirmed = sql`${bookings.status} = 'CASH_CONFIRMED'`;

  const [totals] = await db
    .select({
      cashSales: sql<number>`count(*) filter (where ${confirmed} and ${bookings.counterTender} = 'CASH')::int`,
      cashVisitors: sql<number>`coalesce(sum(${bookings.visitorCount}) filter (where ${confirmed} and ${bookings.counterTender} = 'CASH'), 0)::int`,
      cashAmount: sql<number>`coalesce(sum(${bookings.amountTotal}) filter (where ${confirmed} and ${bookings.counterTender} = 'CASH'), 0)::int`,

      upiSales: sql<number>`count(*) filter (where ${confirmed} and ${bookings.counterTender} = 'UPI')::int`,
      upiVisitors: sql<number>`coalesce(sum(${bookings.visitorCount}) filter (where ${confirmed} and ${bookings.counterTender} = 'UPI'), 0)::int`,
      upiAmount: sql<number>`coalesce(sum(${bookings.amountTotal}) filter (where ${confirmed} and ${bookings.counterTender} = 'UPI'), 0)::int`,

      cancelledSales: sql<number>`count(*) filter (where ${bookings.status} = 'CANCELLED')::int`,
      cancelledAmount: sql<number>`coalesce(sum(${bookings.amountTotal}) filter (where ${bookings.status} = 'CANCELLED'), 0)::int`,

      firstSaleAt: sql<Date | null>`min(coalesce(${bookings.soldOfflineAt}, ${bookings.createdAt})) filter (where ${confirmed})`,
      lastSaleAt: sql<Date | null>`max(coalesce(${bookings.soldOfflineAt}, ${bookings.createdAt})) filter (where ${confirmed})`,
    })
    .from(bookings)
    .where(mine);

  // A one-off price has no category row to name it, so it is labelled by what
  // it is rather than left to fall in with the standard fare it undercuts.
  const rateLabel = sql<string>`coalesce(
    ${rateCategories.name},
    case when ${bookings.rateNote} is not null then 'Special price' else 'Standard' end
  )`;

  const byRate = await db
    .select({
      label: rateLabel,
      sales: sql<number>`count(*)::int`,
      visitors: sql<number>`coalesce(sum(${bookings.visitorCount}), 0)::int`,
      amount: sql<number>`coalesce(sum(${bookings.amountTotal}), 0)::int`,
    })
    .from(bookings)
    .leftJoin(rateCategories, eq(rateCategories.id, bookings.rateCategoryId))
    .where(and(mine, eq(bookings.status, "CASH_CONFIRMED")))
    .groupBy(rateLabel)
    .orderBy(rateLabel);

  const cash: TenderTotals = {
    sales: totals?.cashSales ?? 0,
    visitors: totals?.cashVisitors ?? 0,
    amount: totals?.cashAmount ?? 0,
  };
  const upi: TenderTotals = {
    sales: totals?.upiSales ?? 0,
    visitors: totals?.upiVisitors ?? 0,
    amount: totals?.upiAmount ?? 0,
  };

  return {
    cash,
    upi,
    total: {
      sales: cash.sales + upi.sales,
      visitors: cash.visitors + upi.visitors,
      amount: cash.amount + upi.amount,
    },
    cancelled: {
      sales: totals?.cancelledSales ?? 0,
      amount: totals?.cancelledAmount ?? 0,
    },
    byRate,
    firstSaleAt: totals?.firstSaleAt ?? null,
    lastSaleAt: totals?.lastSaleAt ?? null,
  };
}
