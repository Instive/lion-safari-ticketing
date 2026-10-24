import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, changeLog, tickets } from "@/db/schema";
import { env } from "@/lib/env";
import { decodeSyncCursor, encodeSyncCursor } from "./cursor";
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
  nextCursor: string | null;
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

export const SYNC_PAGE_SIZE = 500;

export type SyncOptions = { cursor?: string; visitDate?: string; syncedAt?: string };

export async function buildSync(
  since: number,
  staleThresholdSeconds: number,
  options: SyncOptions = {},
): Promise<SyncResponse> {
  const today = businessDate();
  const now = serverNow();
  const cursor = options.cursor
    ? decodeSyncCursor(options.cursor, env.SESSION_SECRET, today, now)
    : undefined;
  // Capture the watermark BEFORE reading pages. Changes made during pagination
  // remain eligible for the following sync, including inserts behind the cursor.
  const version = cursor?.version ?? (await db
    .select({ version: sql<number>`coalesce(max(${changeLog.id}), 0)::float8` })
    .from(changeLog))[0]!.version;
  const fullSync = cursor?.fullSync ?? (since <= 0 || (options.visitDate !== undefined && options.visitDate !== today));
  const startedAt = cursor?.startedAt ?? now.toISOString();
  const previousTime = options.syncedAt ? Date.parse(options.syncedAt) : now.getTime();
  // Anchor the overlap to the LAST completed sync, not the last page's time.
  const overlapFrom = cursor?.overlapFrom ?? new Date(
    Math.min(Number.isFinite(previousTime) ? previousTime : now.getTime(), now.getTime()) - OVERLAP_SECONDS * 1000,
  ).toISOString();
  const fromVersion = cursor?.since ?? since;

  const changedIds = db.select({ entityId: changeLog.entityId }).from(changeLog).where(and(
    eq(changeLog.entity, "ticket"),
    or(gt(changeLog.id, fromVersion), gt(changeLog.createdAt, new Date(overlapFrom))),
  ));
  // Keep the change-set in Postgres; no unbounded JS array or 5,000-row truncation.
  const rows = await db.select(ticketColumns()).from(tickets)
    .innerJoin(bookings, eq(bookings.id, tickets.bookingId))
    .where(and(
      eq(tickets.visitDate, today),
      cursor ? gt(tickets.id, cursor.after) : undefined,
      fullSync ? undefined : inArray(tickets.id, changedIds),
    ))
    .orderBy(asc(tickets.id))
    .limit(SYNC_PAGE_SIZE + 1);
  const hasMore = rows.length > SYNC_PAGE_SIZE;
  if (hasMore) rows.pop();
  const nextCursor = hasMore ? encodeSyncCursor({
    since: fromVersion, version, visitDate: today, startedAt, overlapFrom,
    after: rows[rows.length - 1]!.ticketId, fullSync,
  }, env.SESSION_SECRET) : null;

  return {
    serverTime: startedAt,
    version,
    fullSync,
    visitDate: today,
    staleThresholdSeconds,
    nextCursor,
    tickets: rows.map((r) => ({
      ticketId: r.ticketId,
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
