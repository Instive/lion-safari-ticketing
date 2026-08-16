import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import { env } from "./env";

/**
 * Server time is the only authoritative clock in this system. Scanner and
 * browser clocks are never trusted for ticket validity.
 */
export function serverNow(): Date {
  return new Date();
}

/**
 * The park's operating date (YYYY-MM-DD) for a given instant, in the park's
 * timezone. A booking made at 00:30 IST belongs to that IST day, not to the
 * UTC day.
 */
export function businessDate(at: Date = serverNow()): string {
  return format(new TZDate(at, env.APP_TIMEZONE), "yyyy-MM-dd");
}

/** Human-friendly date for tickets and emails, e.g. "Sun, 16 Aug 2026". */
export function formatVisitDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return format(new TZDate(y, m - 1, d, 12, 0, 0, env.APP_TIMEZONE), "EEE, d MMM yyyy");
}

/** Clock time in the park's timezone, e.g. "2:45 PM" — for staff-facing screens. */
export function formatLocalTime(at: Date): string {
  return format(new TZDate(at, env.APP_TIMEZONE), "d MMM, h:mm a");
}
