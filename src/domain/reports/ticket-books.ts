import { and, eq, gte, isNotNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, devices, tickets } from "@/db/schema";
import { env } from "@/lib/env";
import { businessDate } from "@/lib/time";

/**
 * Oversight for the offline ticket books.
 *
 * A pre-issued ticket is admissible at the gate before anyone pays for it —
 * that is the deal that makes offline selling possible (see
 * `src/domain/booking/reserve.ts`). What makes it safe is that every blank is
 * accounted for, every day. These queries are that accounting.
 */

export type BookStock = {
  deviceId: string;
  deviceName: string;
  deviceActive: boolean;
  visitDate: string;
  unsold: number;
  sold: number;
};

/** What each counter device is holding, by date. */
export async function bookStock(fromDate = businessDate()): Promise<BookStock[]> {
  const rows = await db
    .select({
      deviceId: devices.id,
      deviceName: devices.name,
      deviceActive: devices.active,
      visitDate: bookings.visitDate,
      unsold: sql<number>`count(*) filter (where ${bookings.status} = 'RESERVED')::int`,
      sold: sql<number>`count(*) filter (where ${bookings.status} = 'CASH_CONFIRMED')::int`,
    })
    .from(bookings)
    .innerJoin(devices, eq(devices.id, bookings.reservedDeviceId))
    .where(and(isNotNull(bookings.reservedDeviceId), gte(bookings.visitDate, fromDate)))
    .groupBy(devices.id, devices.name, devices.active, bookings.visitDate)
    .orderBy(bookings.visitDate, devices.name);

  return rows;
}

export type BookDiscrepancy = {
  bookingId: string;
  bookingCode: string;
  deviceName: string | null;
  visitDate: string;
  visitorCount: number;
  boardedAt: Date | null;
};

/**
 * The number that matters: blanks that were used at the gate but never turned
 * into a sale.
 *
 * Every one of these is a group that walked in on a ticket nobody is recorded
 * as having paid for. Usually it is a counter device whose queue never synced —
 * worth chasing before the cash is banked. Occasionally it is not, which is
 * exactly why this is reported rather than left for someone to notice.
 */
export async function bookDiscrepancies(fromDate: string, toDate: string): Promise<BookDiscrepancy[]> {
  const rows = await db
    .select({
      bookingId: bookings.id,
      bookingCode: bookings.bookingCode,
      deviceName: devices.name,
      visitDate: bookings.visitDate,
      visitorCount: bookings.visitorCount,
      boardedAt: tickets.usedAt,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .leftJoin(devices, eq(devices.id, bookings.reservedDeviceId))
    .where(
      and(
        isNotNull(bookings.reservedDeviceId),
        // Boarded…
        eq(tickets.status, "USED"),
        // …but never reconciled into a sale.
        eq(bookings.status, "RESERVED"),
        gte(bookings.visitDate, fromDate),
        sql`${bookings.visitDate} <= ${toDate}::date`,
      ),
    )
    .orderBy(tickets.usedAt)
    .limit(200);

  return rows;
}

export type MisdatedSale = {
  bookingId: string;
  bookingCode: string;
  deviceName: string | null;
  visitDate: string;
  soldOnDay: string;
  visitorCount: number;
  amountTotal: number;
  boardedAt: Date | null;
};

/**
 * Offline sales where the ticket's visit date is not the day the till says it
 * sold it.
 *
 * A counter ticket is admissible on exactly one day, so every row here is a
 * guest who paid at the counter and was then turned away at the gate for a
 * WRONG_DATE — or would have been. The cause is a till selling from a book that
 * had rolled over, which `src/lib/counter/park-day.ts` now prevents at source;
 * this query is the check that it stayed prevented, and the way a refund gets
 * found if it ever is not.
 *
 * Computed from columns already on the row rather than a stored flag, so it is
 * true of historical sales too — including any made before the till was fixed.
 *
 * The comparison is done in the park's timezone for the same reason
 * `businessDate` exists: a sale at 00:30 IST belongs to that IST day, and
 * comparing against a UTC date would report every late-evening sale as misdated.
 */
export async function misdatedOfflineSales(
  fromDate: string,
  toDate: string,
): Promise<MisdatedSale[]> {
  const soldDay = sql<string>`(${bookings.soldOfflineAt} AT TIME ZONE ${env.APP_TIMEZONE})::date`;

  const rows = await db
    .select({
      bookingId: bookings.id,
      bookingCode: bookings.bookingCode,
      deviceName: devices.name,
      visitDate: bookings.visitDate,
      soldOnDay: sql<string>`${soldDay}::text`,
      visitorCount: bookings.visitorCount,
      amountTotal: bookings.amountTotal,
      boardedAt: tickets.usedAt,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .leftJoin(devices, eq(devices.id, bookings.reservedDeviceId))
    .where(
      and(
        isNotNull(bookings.soldOfflineAt),
        sql`${bookings.visitDate} <> ${soldDay}`,
        gte(bookings.visitDate, fromDate),
        sql`${bookings.visitDate} <= ${toDate}::date`,
      ),
    )
    .orderBy(bookings.visitDate)
    .limit(200);

  return rows;
}

export type OfflineSalesSummary = {
  count: number;
  visitors: number;
  collectedPaise: number;
};

/** How much of a day's counter trade happened while the link was down. */
export async function offlineSalesFor(
  fromDate: string,
  toDate: string,
): Promise<OfflineSalesSummary> {
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      visitors: sql<number>`coalesce(sum(${bookings.visitorCount}), 0)::int`,
      collectedPaise: sql<number>`coalesce(sum(${bookings.amountTotal}), 0)::bigint`,
    })
    .from(bookings)
    .where(
      and(
        isNotNull(bookings.soldOfflineAt),
        eq(bookings.status, "CASH_CONFIRMED"),
        gte(bookings.visitDate, fromDate),
        sql`${bookings.visitDate} <= ${toDate}::date`,
      ),
    );

  return {
    count: row?.count ?? 0,
    visitors: row?.visitors ?? 0,
    collectedPaise: Number(row?.collectedPaise ?? 0),
  };
}
