import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfMonth, subMonths } from "date-fns";

import { db } from "@/db";
import {
  boardingEvents,
  bookings,
  staffUsers,
  tickets,
  type BookingStatus,
  type TicketStatus,
} from "@/db/schema";
import { env } from "@/lib/env";
import { businessDate } from "@/lib/time";
import {
  PAGE_SIZE,
  RANGE_PRESETS,
  STATUS_FILTERS,
  statusesFor,
  type BookingFilters,
  type ChannelFilter,
  type DateField,
  type RangePreset,
  type StatusFilter,
} from "./filter-options";

export * from "./filter-options";

/**
 * The queries behind the admin bookings view, the CSV download and the nightly
 * report — one definition of "which bookings are we talking about", so a number
 * on screen and a number in a spreadsheet can never disagree. If the export could build
 * its own filter, a number on screen and a number in a spreadsheet would
 * eventually disagree — and the spreadsheet is what gets forwarded.
 */



const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  return businessDate();
}

function shift(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return format(addDays(new TZDate(y!, m! - 1, d!, 12, 0, 0, env.APP_TIMEZONE), days), "yyyy-MM-dd");
}

function monthStart(isoDate: string, monthsBack = 0): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const at = new TZDate(y!, m! - 1, d!, 12, 0, 0, env.APP_TIMEZONE);
  return format(startOfMonth(monthsBack ? subMonths(at, monthsBack) : at), "yyyy-MM-dd");
}

function monthEnd(isoDate: string, monthsBack = 0): string {
  return shift(monthStart(isoDate, monthsBack - 1), -1);
}

/** Resolves a preset to concrete inclusive dates, in the park's timezone. */
export function rangeFor(preset: RangePreset, from?: string, to?: string): { from: string; to: string } {
  const now = today();
  switch (preset) {
    case "today":
      return { from: now, to: now };
    case "yesterday":
      return { from: shift(now, -1), to: shift(now, -1) };
    case "last7":
      return { from: shift(now, -6), to: now };
    case "last30":
      return { from: shift(now, -29), to: now };
    case "this_month":
      return { from: monthStart(now), to: now };
    case "last_month":
      return { from: monthStart(now, 1), to: monthEnd(now, 1) };
    case "custom": {
      const start = from && ISO_DATE.test(from) ? from : now;
      const end = to && ISO_DATE.test(to) ? to : now;
      // A backwards range is a typo, not a query — swap rather than return nothing.
      return start <= end ? { from: start, to: end } : { from: end, to: start };
    }
  }
}

type RawParams = Record<string, string | string[] | undefined>;

function one(params: RawParams, key: string): string | undefined {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Parses URL search params into filters. Every unknown or malformed value falls
 * back to a sane default rather than erroring: this is a URL people edit,
 * bookmark and paste to each other.
 */
export function parseFilters(params: RawParams): BookingFilters {
  const presetRaw = one(params, "range");
  const preset = (RANGE_PRESETS as readonly string[]).includes(presetRaw ?? "")
    ? (presetRaw as RangePreset)
    : "this_month";

  const { from, to } = rangeFor(preset, one(params, "from"), one(params, "to"));

  const statusRaw = one(params, "status");
  const channelRaw = one(params, "channel");
  const pageRaw = Number(one(params, "page") ?? "1");

  return {
    preset,
    from,
    to,
    dateField: one(params, "on") === "booked" ? "booked" : "visit",
    channel:
      channelRaw === "ONLINE" || channelRaw === "COUNTER" ? (channelRaw as ChannelFilter) : "ALL",
    status: (STATUS_FILTERS as readonly string[]).includes(statusRaw ?? "")
      ? (statusRaw as StatusFilter)
      : "ALL",
    q: (one(params, "q") ?? "").trim().slice(0, 120),
    page: Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.floor(pageRaw) : 1,
  };
}

/** Rebuilds a query string, so links and the export share one filter state. */
export function filtersToQuery(filters: BookingFilters, overrides: Partial<BookingFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  params.set("range", merged.preset);
  if (merged.preset === "custom") {
    params.set("from", merged.from);
    params.set("to", merged.to);
  }
  if (merged.dateField !== "visit") params.set("on", merged.dateField);
  if (merged.channel !== "ALL") params.set("channel", merged.channel);
  if (merged.status !== "ALL") params.set("status", merged.status);
  if (merged.q) params.set("q", merged.q);
  if (merged.page > 1) params.set("page", String(merged.page));
  return params.toString();
}

/**
 * The business date of a booking, in the park's timezone. `visit_date` is
 * already a business date; `created_at` is an instant and must be converted, or
 * everything booked after 6:30pm IST lands in the wrong day (spec §6).
 */
function businessDateExpr(dateField: DateField): SQL<string> {
  return dateField === "visit"
    ? sql<string>`${bookings.visitDate}`
    : sql<string>`(${bookings.createdAt} at time zone ${sql.raw(`'${env.APP_TIMEZONE}'`)})::date`;
}

function whereFor(filters: BookingFilters): SQL {
  const dateExpr = businessDateExpr(filters.dateField);
  const clauses: (SQL | undefined)[] = [
    sql`${dateExpr} between ${filters.from}::date and ${filters.to}::date`,
  ];

  if (filters.channel !== "ALL") clauses.push(eq(bookings.channel, filters.channel));

  const statuses = statusesFor(filters.status);
  if (statuses) {
    clauses.push(
      statuses.length === 1
        ? eq(bookings.status, statuses[0]!)
        : inArray(bookings.status, statuses),
    );
  } else {
    // "All statuses" means all *sales*. An unsold blank in a counter's ticket
    // book is stock, not a booking anyone made, and letting hundreds of them
    // into the table and the CSV would bury the real ones. Asking for RESERVED
    // explicitly still shows them.
    clauses.push(sql`${bookings.status} <> 'RESERVED'`);
  }

  if (filters.q) {
    const like = `%${filters.q.toLowerCase()}%`;
    clauses.push(
      or(
        eq(bookings.bookingCode, filters.q.toUpperCase()),
        sql`${bookings.customerPhone} like ${`%${filters.q}%`}`,
        sql`lower(${bookings.customerName}) like ${like}`,
        sql`lower(${bookings.customerEmail}) like ${like}`,
      ),
    );
  }

  return and(...clauses.filter(Boolean)) as SQL;
}

export type BookingRow = {
  id: string;
  bookingCode: string;
  channel: "ONLINE" | "COUNTER";
  status: BookingStatus;
  ticketStatus: TicketStatus | null;
  visitorCount: number;
  amountTotal: number;
  convenienceFee: number;
  visitDate: string;
  createdAt: Date;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  soldBy: string | null;
  boardedCount: number;
};

function selection() {
  return {
    id: bookings.id,
    bookingCode: bookings.bookingCode,
    channel: bookings.channel,
    status: bookings.status,
    ticketStatus: tickets.status,
    visitorCount: bookings.visitorCount,
    amountTotal: bookings.amountTotal,
    convenienceFee: bookings.convenienceFee,
    visitDate: bookings.visitDate,
    createdAt: bookings.createdAt,
    customerName: bookings.customerName,
    customerPhone: bookings.customerPhone,
    customerEmail: bookings.customerEmail,
    soldBy: staffUsers.username,
    boardedCount: sql<number>`coalesce((
      select sum(${boardingEvents.boardedCount})
      from ${boardingEvents}
      where ${boardingEvents.ticketId} = ${tickets.id}
    ), 0)::int`,
  };
}

function baseQuery() {
  return db
    .select(selection())
    .from(bookings)
    .leftJoin(tickets, eq(tickets.bookingId, bookings.id))
    .leftJoin(staffUsers, eq(staffUsers.id, bookings.createdByStaffId));
}

/** One page of the table, newest first. */
export async function listBookings(
  filters: BookingFilters,
  limit = PAGE_SIZE,
): Promise<BookingRow[]> {
  return baseQuery()
    .where(whereFor(filters))
    .orderBy(desc(bookings.createdAt))
    .limit(limit)
    .offset((filters.page - 1) * limit) as Promise<BookingRow[]>;
}

/**
 * Every row matching the filter, in stable order, a batch at a time — so an
 * export of a whole month never holds the whole month in memory.
 */
export async function* streamBookings(
  filters: BookingFilters,
  batchSize = 1000,
): AsyncGenerator<BookingRow[]> {
  let offset = 0;
  for (;;) {
    const batch = (await baseQuery()
      .where(whereFor(filters))
      .orderBy(asc(bookings.createdAt), asc(bookings.id))
      .limit(batchSize)
      .offset(offset)) as BookingRow[];

    if (batch.length === 0) return;
    yield batch;
    if (batch.length < batchSize) return;
    offset += batchSize;
  }
}

export type BookingTotals = {
  bookings: number;
  confirmedBookings: number;
  visitors: number;
  collectedPaise: number;
  refundedPaise: number;
  pending: number;
  online: number;
  counter: number;
  boarded: number;
};

/**
 * Totals for the WHOLE filtered set, not the visible page. Collected counts
 * confirmed money only — a cancelled booking's amount was never in the drawer,
 * and refunds are reported separately rather than netted off, so the two
 * numbers can each be checked against a statement.
 */
export async function bookingTotals(filters: BookingFilters): Promise<BookingTotals> {
  const [row] = await db
    .select({
      bookings: sql<number>`count(*)::int`,
      confirmedBookings: sql<number>`count(*) filter (where ${bookings.status} in ('PAID','CASH_CONFIRMED'))::int`,
      visitors: sql<number>`coalesce(sum(${bookings.visitorCount}) filter (where ${bookings.status} in ('PAID','CASH_CONFIRMED')), 0)::int`,
      collectedPaise: sql<number>`coalesce(sum(${bookings.amountTotal}) filter (where ${bookings.status} in ('PAID','CASH_CONFIRMED')), 0)::bigint`,
      refundedPaise: sql<number>`coalesce(sum(${bookings.amountTotal}) filter (where ${bookings.status} = 'REFUNDED'), 0)::bigint`,
      pending: sql<number>`count(*) filter (where ${bookings.status} = 'PENDING')::int`,
      online: sql<number>`count(*) filter (where ${bookings.channel} = 'ONLINE' and ${bookings.status} in ('PAID','CASH_CONFIRMED'))::int`,
      counter: sql<number>`count(*) filter (where ${bookings.channel} = 'COUNTER' and ${bookings.status} in ('PAID','CASH_CONFIRMED'))::int`,
    })
    .from(bookings)
    .where(whereFor(filters));

  const [boarded] = await db
    .select({
      boarded: sql<number>`coalesce(sum(${boardingEvents.boardedCount}), 0)::int`,
    })
    .from(boardingEvents)
    .innerJoin(tickets, eq(tickets.id, boardingEvents.ticketId))
    .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
    .where(whereFor(filters));

  return {
    bookings: row?.bookings ?? 0,
    confirmedBookings: row?.confirmedBookings ?? 0,
    visitors: row?.visitors ?? 0,
    // bigint sums come back as strings from the driver.
    collectedPaise: Number(row?.collectedPaise ?? 0),
    refundedPaise: Number(row?.refundedPaise ?? 0),
    pending: row?.pending ?? 0,
    online: row?.online ?? 0,
    counter: row?.counter ?? 0,
    boarded: boarded?.boarded ?? 0,
  };
}

export type DayTotal = {
  date: string;
  bookings: number;
  visitors: number;
  collectedPaise: number;
};

/** Day-by-day totals for the filtered range — the "which day was busy" view. */
export async function dailyTotals(filters: BookingFilters, limit = 92): Promise<DayTotal[]> {
  const dateExpr = businessDateExpr(filters.dateField);

  const rows = await db
    .select({
      date: sql<string>`to_char(${dateExpr}, 'YYYY-MM-DD')`,
      bookings: sql<number>`count(*)::int`,
      visitors: sql<number>`coalesce(sum(${bookings.visitorCount}) filter (where ${bookings.status} in ('PAID','CASH_CONFIRMED')), 0)::int`,
      collectedPaise: sql<number>`coalesce(sum(${bookings.amountTotal}) filter (where ${bookings.status} in ('PAID','CASH_CONFIRMED')), 0)::bigint`,
    })
    .from(bookings)
    .where(whereFor(filters))
    .groupBy(dateExpr)
    .orderBy(sql`1 desc`)
    .limit(limit);

  return rows.map((r) => ({ ...r, collectedPaise: Number(r.collectedPaise) }));
}

export async function countBookings(filters: BookingFilters): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(bookings)
    .where(whereFor(filters));
  return row?.count ?? 0;
}
