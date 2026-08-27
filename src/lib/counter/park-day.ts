import { deviceCalendarDate } from "@/lib/format-date";

/**
 * Which park day an offline till may sell for.
 *
 * A counter ticket is admissible on exactly one day — the gate rejects any
 * other date, both server-side (`domain/boarding/confirm.ts`) and on the
 * scanner (`lib/scanner/judge.ts`). So the till must never hand a guest a
 * blank dated anything other than the day they are standing there.
 *
 * The till used to sell for `meta.visitDate` — the day of its LAST SUCCESSFUL
 * SYNC. A device that synced at 6pm, stayed offline overnight and sold at 9am
 * claimed a blank dated yesterday: the guest was turned away at the gate, and
 * on reconnect the sale could not be reconciled either, because the rollover
 * sweep had already voided that blank. Cash taken, no record, no entry.
 *
 * The device clock is what tells us the day has turned. That does NOT make it
 * authoritative — rule §6 stands, and nothing here decides whether a ticket is
 * VALID; the server and the gate still do that against server time. The clock
 * is used for two conservative things only:
 *
 *   - to move FORWARD onto blanks the server already allocated for that date
 *     (this is what `BOOK_HORIZON_DAYS` stocks the book for — "an outage that
 *     begins overnight still finds stock"), and
 *   - to STOP selling when it cannot be reconciled with the last sync.
 *
 * A skewed clock therefore cannot admit anyone who should not be admitted. The
 * worst it can do is print a date the gate refuses, which is what happens
 * today anyway — and the `heldDates` guard bounds even that to dates the
 * server itself put in this book.
 */
export type ParkDayResolution =
  /** Sell for this day. `advanced` means the clock, not the sync, chose it. */
  | { day: string; advanced: boolean; blocked: null }
  /** Do not sell offline. */
  | { day: null; advanced: false; blocked: SellBlockReason };

export type SellBlockReason =
  /** No sync has ever landed, so there is no book and no known park day. */
  | "NO_SYNC"
  /** The device clock reads earlier than the last sync — it cannot be believed. */
  | "CLOCK_BEHIND"
  /** The day has turned past everything the server stocked this book for. */
  | "STALE_BOOK";

/**
 * @param syncedDay  the park day the SERVER reported at the last sync.
 * @param heldDates  visit dates this till still holds blanks for.
 * @param deviceNow  the device's own clock. Never trusted to admit, only to stop.
 */
export function resolveParkDay(
  syncedDay: string | null,
  heldDates: Iterable<string>,
  deviceNow: Date = new Date(),
): ParkDayResolution {
  if (!syncedDay) return { day: null, advanced: false, blocked: "NO_SYNC" };

  const deviceDay = deviceCalendarDate(deviceNow);

  // The overwhelmingly common case: synced today, selling today.
  if (deviceDay === syncedDay) return { day: syncedDay, advanced: false, blocked: null };

  // Clock behind the last sync. Either it was set back or it lost its battery;
  // either way it cannot be used to date a ticket, and carrying on with the
  // synced day would risk selling into a day that has already ended.
  if (deviceDay < syncedDay) return { day: null, advanced: false, blocked: "CLOCK_BEHIND" };

  // The day has turned. Only follow it onto dates the SERVER stocked this book
  // for — that bounds the move to the allocation horizon without this module
  // needing to know what the horizon is.
  const held = heldDates instanceof Set ? heldDates : new Set(heldDates);
  if (held.has(deviceDay)) return { day: deviceDay, advanced: true, blocked: null };

  return { day: null, advanced: false, blocked: "STALE_BOOK" };
}

/** Staff-facing wording for a till that cannot sell offline (spec §17). */
export function blockMessage(reason: SellBlockReason): string {
  switch (reason) {
    case "NO_SYNC":
      return "This till has no ticket book yet. Connect to the internet once before selling offline.";
    case "CLOCK_BEHIND":
      return "This device's date looks wrong, so a ticket printed now could be refused at the gate. Fix the date, or reconnect to the internet.";
    case "STALE_BOOK":
      return "This till's ticket book is out of date. Reconnect to the internet before selling — a ticket printed now would be refused at the gate.";
  }
}
