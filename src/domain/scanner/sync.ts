import { and, eq, gt, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, changeLog, tickets } from "@/db/schema";
import { businessDate, serverNow } from "@/lib/time";

/**
 * What the scanner stores locally for one ticket.
 *
 * Note what is absent: the ticket token, the customer's name, phone and email.
 * The device holds only a SHA-256 hash of the token, which is enough to
 * recognise a scanned QR but useless to anyone who steals the device.
 */
export type SyncTicket = {
  ticketId: string;
  tokenHash: string;
  bookingCode: string;
  status: "ACTIVE" | "USED" | "CANCELLED" | "EXPIRED";
  visitorCount: number;
  visitDate: string;
  usedAt: string | null;
};

export type SyncResponse = {
  /** Authoritative time. The scanner shows staleness against this, not its own clock. */
  serverTime: string;
  version: number;
  fullSync: boolean;
  visitDate: string;
  tickets: SyncTicket[];
  staleThresholdSeconds: number;
};

/**
 * Overlap window that closes the sequence-visibility gap.
 *
 * `change_log.id` comes from a sequence assigned at INSERT but only visible at
 * COMMIT, so a slower transaction can commit a lower id after a higher one is
 * already published. Re-sending anything written in the last 30 seconds means
 * such a row is never skipped; the scanner applies changes as upserts, so the
 * repetition is harmless.
 */
const OVERLAP_SECONDS = 30;

export async function buildSync(
  since: number,
  staleThresholdSeconds: number,
): Promise<SyncResponse> {
  const today = businessDate();
  const now = serverNow();

  const [{ version }] = await db
    .select({ version: sql<number>`coalesce(max(${changeLog.id}), 0)::int` })
    .from(changeLog);

  const fullSync = since <= 0;

  const rows = fullSync
    ? // First sync of the shift: the whole manifest for today.
      await db
        .select(ticketColumns())
        .from(tickets)
        .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
        .where(eq(tickets.visitDate, today))
    : await (async () => {
        const changed = await db
          .selectDistinct({ entityId: changeLog.entityId })
          .from(changeLog)
          .where(
            and(
              eq(changeLog.entity, "ticket"),
              or(
                gt(changeLog.id, since),
                gt(changeLog.createdAt, new Date(now.getTime() - OVERLAP_SECONDS * 1000)),
              ),
            ),
          )
          .limit(5000);

        if (changed.length === 0) return [];

        return db
          .select(ticketColumns())
          .from(tickets)
          .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
          .where(
            and(
              eq(tickets.visitDate, today),
              inArray(
                tickets.id,
                changed.map((c) => c.entityId),
              ),
            ),
          );
      })();

  return {
    serverTime: now.toISOString(),
    version,
    fullSync,
    visitDate: today,
    staleThresholdSeconds,
    tickets: rows.map((r) => ({
      ticketId: r.ticketId,
      // Hashing happens server-side so the raw token never leaves the database
      // for the gate device.
      tokenHash: r.tokenHash,
      bookingCode: r.bookingCode,
      status: r.status,
      visitorCount: r.visitorCount,
      visitDate: r.visitDate,
      usedAt: r.usedAt ? r.usedAt.toISOString() : null,
    })),
  };
}

function ticketColumns() {
  return {
    ticketId: tickets.id,
    // Built-in sha256() (PG 11+), so no pgcrypto extension is required.
    tokenHash: sql<string>`encode(sha256(convert_to(${tickets.token}, 'UTF8')), 'hex')`,
    bookingCode: bookings.bookingCode,
    status: tickets.status,
    visitorCount: tickets.visitorCount,
    visitDate: tickets.visitDate,
    usedAt: tickets.usedAt,
  };
}
