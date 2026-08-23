import type { BookingStatus } from "@/db/schema";

/**
 * The filter vocabulary: the values a bookings view can be sliced by, and the
 * words used for them.
 *
 * Deliberately free of database and environment imports so the filter UI (a
 * Client Component) can share these constants with the queries. Everything that
 * touches the database or the server clock lives in `./bookings`, which must
 * never be imported from the client — doing so pulls the Postgres driver and
 * `@/lib/env`, secrets and all, into the browser bundle.
 */

export const RANGE_PRESETS = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "this_month",
  "last_month",
  "custom",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const PRESET_LABELS: Record<RangePreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last7: "Last 7 days",
  last30: "Last 30 days",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom",
};

/**
 * Which date a filter means. A booking made on the 31st for a visit on the 1st
 * belongs to different months depending on the question being asked — "what did
 * we take last month" is a booking date, "who is coming on Sunday" is a visit
 * date. Confusing the two is how reported revenue drifts from the bank.
 */
export type DateField = "visit" | "booked";

export const STATUS_FILTERS = [
  "ALL",
  "CONFIRMED",
  "PENDING",
  "PAID",
  "CASH_CONFIRMED",
  "FAILED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
  "RESERVED",
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const STATUS_LABELS: Record<StatusFilter, string> = {
  ALL: "All statuses",
  CONFIRMED: "Confirmed (paid + cash)",
  PENDING: "Awaiting payment",
  PAID: "Paid online",
  CASH_CONFIRMED: "Cash at counter",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  REFUND_PENDING: "Refund pending",
  REFUNDED: "Refunded",
  RESERVED: "Unsold blanks (ticket books)",
};

export type ChannelFilter = "ALL" | "ONLINE" | "COUNTER";

export type BookingFilters = {
  preset: RangePreset;
  /** Inclusive business dates, yyyy-MM-dd, always in the park's timezone. */
  from: string;
  to: string;
  dateField: DateField;
  channel: ChannelFilter;
  status: StatusFilter;
  q: string;
  page: number;
};

export const PAGE_SIZE = 50;

/** Narrows a status filter to the concrete booking statuses it selects. */
export function statusesFor(filter: StatusFilter): BookingStatus[] | null {
  if (filter === "ALL") return null;
  if (filter === "CONFIRMED") return ["PAID", "CASH_CONFIRMED"];
  return [filter];
}

/** Rebuilds a query string, so links and the export share one filter state. */
export function filtersToQuery(
  filters: BookingFilters,
  overrides: Partial<BookingFilters> = {},
): string {
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
