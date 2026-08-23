import { format } from "date-fns";

/**
 * Date formatting that is safe to run in the browser.
 *
 * `@/lib/time` is the authority on dates in this system, but it resolves the
 * park's timezone from `@/lib/env` — which validates server secrets the moment
 * it loads and therefore must never reach a Client Component. These helpers use
 * the same date-fns format strings, so output is identical in shape, without
 * pulling the environment along.
 *
 * Used by the counter when it prints a ticket during an outage, where the
 * device's own clock is the only clock there is.
 */

/**
 * A calendar date with no time in it — "Fri, 21 Aug 2026".
 *
 * Anchored at local noon so no timezone or DST shift can roll it onto the
 * neighbouring day, which is the classic way a visit date prints wrong.
 */
export function formatCalendarDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return format(new Date(year!, month! - 1, day!, 12, 0, 0), "EEE, d MMM yyyy");
}

/** An instant on the device's own clock — "21 Aug 2026, 8:47 PM". */
export function formatDeviceDateTime(at: Date): string {
  return format(at, "d MMM yyyy, h:mm a");
}
