import type { CachedTicket } from "./db";

/**
 * The scanner's verdict on a scanned ticket.
 *
 * Lives outside the React component so it can be exercised directly by
 * scripts/verify-scanner.ts — this is the decision that admits or turns away a
 * guest at the gate, and it was previously unreachable from any check. The
 * type-only import above keeps this module free of Dexie at runtime.
 */
export type ScanOutcome =
  | { kind: "VALID"; ticket: CachedTicket }
  | { kind: "REJECTED"; message: string; detail?: string; ticket?: CachedTicket | null }
  | { kind: "UNKNOWN_OFFLINE" };

/**
 * `parkDay` is the visit date the SERVER sent with the last sync, never a date
 * derived from this device.
 *
 * `new Date().toISOString()` is always UTC, so deriving the day here rejected
 * every valid ticket between midnight and 05:30 IST — the device was still on
 * the previous UTC day while the park had already rolled over. Server time is
 * the only authoritative clock in this system; the device clock is audit data.
 */
export function judge(ticket: CachedTicket, parkDay: string | null): ScanOutcome {
  if (ticket.status === "USED") {
    return {
      kind: "REJECTED",
      message: "ALREADY USED",
      detail: ticket.usedAt
        ? `Boarded at ${new Date(ticket.usedAt).toLocaleTimeString()}`
        : "This ticket has already been used.",
      ticket,
    };
  }
  if (ticket.status === "CANCELLED") {
    return { kind: "REJECTED", message: "CANCELLED", detail: "This booking was cancelled.", ticket };
  }
  if (ticket.status === "EXPIRED") {
    return { kind: "REJECTED", message: "EXPIRED", detail: "This ticket is no longer valid.", ticket };
  }
  if (parkDay === null) {
    // A cached ticket without a synced day should be unreachable, since the
    // cache is only ever filled by a sync that also records the day. Say what
    // is actually wrong rather than blaming the ticket's date.
    return {
      kind: "REJECTED",
      message: "SYNC NEEDED",
      detail: "This scanner has not synced yet. Check the connection.",
      ticket,
    };
  }
  if (ticket.visitDate !== parkDay) {
    return {
      kind: "REJECTED",
      message: "WRONG DATE",
      detail: `This ticket is for ${ticket.visitDate}, not ${parkDay}.`,
      ticket,
    };
  }
  return { kind: "VALID", ticket };
}
