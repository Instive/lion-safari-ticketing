import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, type BookingStatus } from "@/db/schema";

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
