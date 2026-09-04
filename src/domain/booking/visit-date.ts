import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

import { env } from "@/lib/env";
import { businessDate } from "@/lib/time";
import { DomainError } from "../errors";

/**
 * How far ahead an online booking may be made, counting today as day 0.
 * 15 days ahead therefore means 16 selectable dates.
 */
export const MAX_ADVANCE_DAYS = 15;

/**
 * The weekday the park is closed, as `Date.getDay()` numbers it (0 = Sunday).
 * The public site states "Closed Mondays" in the footer; this is the rule that
 * enforces it, so the two must be changed together.
 */
const CLOSED_WEEKDAY = 1;

/**
 * The hour (park time, 24h) after which today can no longer be booked online.
 *
 * The park closes at 5pm, so a ticket bought at 5:30pm for "today" is one the
 * guest can never use — the gate is shut and `confirmBoarding` would reject it
 * tomorrow as WRONG_DATE. Selling it would be taking money for nothing.
 *
 * Note the public site also advertises "last entry one hour before closing",
 * which would make 16 the stricter and arguably more correct value. 17 is what
 * is enforced here deliberately; change this one constant to move it.
 */
const TODAY_CUTOFF_HOUR = 17;

/** The park's current hour (0-23), in park time. */
function currentHour(): number {
  return new TZDate(new Date(), env.APP_TIMEZONE).getHours();
}

/**
 * Whether today can still be booked, i.e. the park has not closed yet.
 *
 * Exported so the booking page can move the picker off today rather than
 * offering a date the server is about to refuse.
 */
export function isTodayStillBookable(): boolean {
  return currentHour() < TODAY_CUTOFF_HOUR;
}

/** ISO date (YYYY-MM-DD) `days` after the park's today. */
function addBusinessDays(days: number): string {
  const now = new TZDate(new Date(), env.APP_TIMEZONE);
  // Midday avoids any chance of a DST shift moving the date across midnight.
  const shifted = new TZDate(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + days,
    12,
    0,
    0,
    env.APP_TIMEZONE,
  );
  return format(shifted, "yyyy-MM-dd");
}

/** Whether an ISO date falls on the park's closed weekday, in park time. */
export function isClosedDay(isoDate: string): boolean {
  const [y, m, d] = isoDate.split("-").map(Number);
  const at = new TZDate(y!, m! - 1, d!, 12, 0, 0, env.APP_TIMEZONE);
  return at.getDay() === CLOSED_WEEKDAY;
}

/**
 * The earliest and latest date an online booking may be made for.
 *
 * After the park closes, `min` moves to tomorrow: today is no longer sellable,
 * so offering it in the date input would only produce a rejection at checkout.
 * `max` stays anchored to today, so the window shrinks by a day rather than
 * sliding forward — the promise is "15 days ahead", not "16 on some evenings".
 */
export function bookableRange(): { min: string; max: string } {
  const min = isTodayStillBookable() ? businessDate() : addBusinessDays(1);
  return { min, max: addBusinessDays(MAX_ADVANCE_DAYS) };
}

/**
 * The first bookable day on or after `isoDate`, skipping closed days.
 *
 * The booking form opens on this rather than blindly on today: landing on a
 * Monday with a date the server is guaranteed to reject reads as the form
 * being broken.
 */
export function nextOpenDay(isoDate: string): string {
  for (let offset = 0; offset <= MAX_ADVANCE_DAYS; offset++) {
    const candidate = offset === 0 ? isoDate : addDaysTo(isoDate, offset);
    if (!isClosedDay(candidate)) return candidate;
  }
  return isoDate;
}

/** ISO date `days` after another ISO date, in park time. */
function addDaysTo(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const shifted = new TZDate(y!, m! - 1, d! + days, 12, 0, 0, env.APP_TIMEZONE);
  return format(shifted, "yyyy-MM-dd");
}

/**
 * Validates a customer-supplied visit date against the park's rules.
 *
 * Server-side and authoritative: the form sets `min`/`max` on the date input
 * and hides closed days, but a browser can send anything, so every rule is
 * re-checked here (spec §6 — the device is never the source of truth).
 *
 * Throws `DomainError` so the wording reaching the customer is deliberate
 * rather than a raw validation string.
 */
export function assertBookableVisitDate(isoDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    throw new DomainError("INVALID_VISIT_DATE", "Please choose a valid visit date.");
  }

  const today = businessDate();
  const { min, max } = bookableRange();

  // Today, after closing — worth its own message, because "that date has
  // already passed" is untrue and unhelpful at 5:30pm on the day itself.
  if (isoDate === today && !isTodayStillBookable()) {
    throw new DomainError(
      "PARK_CLOSED_FOR_TODAY",
      "Today's safari has closed. Please choose a later date.",
    );
  }

  if (isoDate < min) {
    throw new DomainError(
      "VISIT_DATE_IN_PAST",
      "That date has already passed. Please choose today or a later date.",
    );
  }
  if (isoDate > max) {
    throw new DomainError(
      "VISIT_DATE_TOO_FAR",
      `Bookings open ${MAX_ADVANCE_DAYS} days ahead. Please choose an earlier date.`,
    );
  }
  if (isClosedDay(isoDate)) {
    throw new DomainError(
      "PARK_CLOSED",
      "The park is closed on Mondays. Please choose another date.",
    );
  }
}
