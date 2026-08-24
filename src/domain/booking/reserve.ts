import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import { db, type Tx } from "@/db";
import {
  bookings,
  tickets,
  type Booking,
  type CounterTender,
  type Ticket,
} from "@/db/schema";
import { generateBookingCode } from "@/lib/codes";
import { businessDate } from "@/lib/time";
import { writeAudit, writeChange, type Actor } from "../audit";
import { DomainError } from "../errors";
import { issueReservedTicket } from "../ticket/issue";
import { quoteFor, resolveRate, type RateSelection } from "./pricing";
import { transitionBooking } from "./status";

/**
 * Ticket books: batches of tickets pre-issued to a counter device so the counter
 * can keep selling when the internet is down.
 *
 * Why pre-issue rather than let the counter mint tickets locally: the gate
 * admits a ticket by finding its token hash in the manifest the SERVER built
 * (`src/domain/scanner/sync.ts`). A token invented on the counter during an
 * outage has never been seen by the server, so the scanner would reject it as
 * UNKNOWN_OFFLINE — the park would sell a ticket its own gate refuses. A
 * pre-issued ticket is an ordinary row that synced to the scanner hours
 * earlier, so it scans normally with no scanner changes at all.
 *
 * The cost of that is stated in `issueReservedTicket`: a blank in the book is
 * admissible before anyone pays for it. Everything below exists to bound and
 * account for that.
 */

/**
 * How many blanks of each group size to keep on a device, per visit date.
 *
 * Shaped like real counter traffic — most groups are two to five people — and
 * kept small on purpose: the book is the exposure, so it should cover a day's
 * selling and no more. A group larger than the biggest denomination is served
 * with two tickets, the way a paper book has always handled it.
 */
export const DEFAULT_BOOK: Record<number, number> = {
  1: 20,
  2: 30,
  3: 25,
  4: 20,
  5: 15,
  6: 10,
  8: 5,
  10: 5,
};

/** Blanks are prepared for today and the next two days. */
export const BOOK_HORIZON_DAYS = 2;

export type ReservedBlank = {
  bookingId: string;
  bookingCode: string;
  token: string;
  visitorCount: number;
  visitDate: string;
};

/**
 * Tops a device's book up to target for one visit date, creating only what is
 * missing. Safe to call on every counter load: a device that is already stocked
 * gets nothing new.
 */
export async function allocateBook(input: {
  deviceId: string;
  visitDate: string;
  denominations?: Record<number, number>;
  actor: Actor;
}): Promise<{ created: number; batchId: string | null }> {
  const target = input.denominations ?? DEFAULT_BOOK;

  return db.transaction(async (tx) => {
    const held = await unsoldCountsByDenomination(tx, input.deviceId, input.visitDate);
    const batchId = crypto.randomUUID();
    let created = 0;

    for (const [size, want] of Object.entries(target)) {
      const visitorCount = Number(size);
      const missing = want - (held.get(visitorCount) ?? 0);

      for (let i = 0; i < missing; i++) {
        const booking = await insertReservedBooking(tx, {
          visitorCount,
          visitDate: input.visitDate,
          reservedDeviceId: input.deviceId,
          reservedBatchId: batchId,
        });
        // A booking-code collision that survived five draws is vanishingly
        // unlikely; skip that blank rather than failing the whole allocation.
        if (!booking) continue;

        await issueReservedTicket(tx, booking, input.actor);
        created += 1;
      }
    }

    if (created > 0) {
      await writeAudit(tx, {
        actor: input.actor,
        action: "book.allocated",
        entity: "device",
        entityId: input.deviceId,
        after: { batchId, visitDate: input.visitDate, created },
      });
    }

    return { created, batchId: created > 0 ? batchId : null };
  });
}

/** Everything still unsold on this device, oldest first, with tokens to print. */
export async function loadBook(
  deviceId: string,
  visitDates: string[],
): Promise<ReservedBlank[]> {
  if (visitDates.length === 0) return [];

  const rows = await db
    .select({
      bookingId: bookings.id,
      bookingCode: bookings.bookingCode,
      token: tickets.token,
      visitorCount: bookings.visitorCount,
      visitDate: bookings.visitDate,
    })
    .from(bookings)
    .innerJoin(tickets, eq(tickets.bookingId, bookings.id))
    .where(
      and(
        eq(bookings.reservedDeviceId, deviceId),
        eq(bookings.status, "RESERVED"),
        eq(tickets.status, "ACTIVE"),
        inArray(bookings.visitDate, visitDates),
      ),
    )
    .orderBy(asc(bookings.visitDate), asc(bookings.visitorCount), asc(bookings.createdAt));

  return rows;
}

export type ActivateInput = {
  bookingId: string;
  /** Which device is claiming the sale — must be the one holding the blank. */
  deviceId: string;
  rate?: RateSelection;
  /** Cash or UPI, as recorded on the till. Defaults to cash. */
  tender?: CounterTender;
  customerName?: string | null;
  customerPhone?: string | null;
  /** The counter device's clock at the moment of sale. Audit only. */
  soldOfflineAt?: string | null;
  createdByStaffId?: string | null;
  actor: Actor;
};

export type ActivateResult = {
  booking: Booking;
  /** False when this sale had already been reconciled by an earlier push. */
  activated: boolean;
};

/**
 * Turns a sold blank into a real cash sale.
 *
 * The visitor count is NOT taken from the request: it is whatever the blank was
 * printed for, which is what the guest is holding and what the gate will count.
 * The amount is recomputed here from that count and the rate, exactly as an
 * online counter sale is — the device reports what it sold, never what it cost
 * (spec §4.3).
 *
 * Idempotent: pushing the same queued sale twice returns the first result, so a
 * flaky reconnect cannot double-charge or double-count a booking.
 */
export async function activateReservedBooking(input: ActivateInput): Promise<ActivateResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, input.bookingId))
      .for("update")
      .limit(1);

    if (!current) throw new DomainError("BLANK_NOT_FOUND", "That ticket is not recognised.");

    if (current.reservedDeviceId !== input.deviceId) {
      // Another device's blank. Refusing keeps a stolen key from consuming a
      // book that is not its own.
      throw new DomainError(
        "BLANK_WRONG_DEVICE",
        "That ticket belongs to another counter.",
        `blank=${current.reservedDeviceId} claimed by ${input.deviceId}`,
      );
    }

    // Already reconciled by an earlier push of the same queued sale.
    if (current.status === "CASH_CONFIRMED") {
      return { booking: current, activated: false };
    }
    if (current.status !== "RESERVED") {
      throw new DomainError(
        "BLANK_NOT_SELLABLE",
        "That ticket can no longer be sold.",
        `status=${current.status}`,
      );
    }

    const rate = await resolveRate(input.rate, "COUNTER", tx);
    const quote = quoteFor(current.visitorCount, "COUNTER", rate);

    await tx
      .update(bookings)
      .set({
        amountTotal: quote.amountTotalPaise,
        convenienceFee: quote.convenienceFeePaise,
        perVisitorPaise: quote.perVisitorPaise,
        rateCategoryId: rate.categoryId,
        rateNote: rate.note,
        counterTender: input.tender ?? "CASH",
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        createdByStaffId: input.createdByStaffId ?? null,
        soldOfflineAt: input.soldOfflineAt ? new Date(input.soldOfflineAt) : null,
        updatedAt: new Date(),
      })
      .where(eq(bookings.id, current.id));

    // Status moves through the transition table like every other status change
    // in the system — there is no generic "set status" path (spec §16).
    const confirmed = await transitionBooking(tx, current.id, "CASH_CONFIRMED", input.actor, {
      soldOffline: true,
      soldOfflineAt: input.soldOfflineAt ?? null,
      tender: input.tender ?? "CASH",
      rate: rate.label,
      perVisitorPaise: quote.perVisitorPaise,
      amountTotal: quote.amountTotalPaise,
    });

    return { booking: confirmed ?? current, activated: true };
  });
}

/**
 * Voids blanks whose visit date has passed. Run at rollover so an unsold ticket
 * can never be carried into another day — the property that keeps a book's
 * exposure to a single day's selling.
 */
export async function expireStaleBlanks(actor: Actor, today = businessDate()): Promise<number> {
  const stale = await db
    .select({ id: bookings.id })
    .from(bookings)
    .where(and(eq(bookings.status, "RESERVED"), lt(bookings.visitDate, today)))
    .limit(2000);

  let expired = 0;
  for (const row of stale) {
    await db.transaction(async (tx) => {
      await transitionBooking(tx, row.id, "CANCELLED", actor, { reason: "unsold blank expired" });
      // Takes the ticket out of the gate manifest too.
      const [ticket] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.bookingId, row.id))
        .for("update")
        .limit(1);

      if (ticket && ticket.status === "ACTIVE") {
        await tx
          .update(tickets)
          .set({ status: "EXPIRED", updatedAt: new Date() })
          .where(eq(tickets.id, ticket.id));

        await writeChange(tx, {
          entity: "ticket",
          entityId: ticket.id,
          operation: "UPDATE",
          payload: { status: "EXPIRED" },
        });
      }
    });
    expired += 1;
  }

  return expired;
}

// ---------------------------------------------------------------------------

async function unsoldCountsByDenomination(
  tx: Tx,
  deviceId: string,
  visitDate: string,
): Promise<Map<number, number>> {
  const rows = await tx
    .select({
      visitorCount: bookings.visitorCount,
      held: sql<number>`count(*)::int`,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.reservedDeviceId, deviceId),
        eq(bookings.status, "RESERVED"),
        eq(bookings.visitDate, visitDate),
      ),
    )
    .groupBy(bookings.visitorCount);

  return new Map(rows.map((r) => [r.visitorCount, r.held]));
}

/**
 * A blank costs nothing until it is sold: amount and per-visitor price are zero
 * and are filled in by `activateReservedBooking` from a server-side quote.
 */
async function insertReservedBooking(
  tx: Tx,
  values: {
    visitorCount: number;
    visitDate: string;
    reservedDeviceId: string;
    reservedBatchId: string;
  },
): Promise<Booking | undefined> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await tx
      .insert(bookings)
      .values({
        bookingCode: generateBookingCode(),
        channel: "COUNTER",
        status: "RESERVED",
        visitorCount: values.visitorCount,
        amountTotal: 0,
        convenienceFee: 0,
        perVisitorPaise: 0,
        visitDate: values.visitDate,
        reservedDeviceId: values.reservedDeviceId,
        reservedBatchId: values.reservedBatchId,
        // Unique per blank, so a replayed allocation cannot duplicate one.
        idempotencyKey: `blank:${crypto.randomUUID()}`,
      })
      .onConflictDoNothing()
      .returning();

    if (row) return row;
  }
  return undefined;
}

export type { Ticket };
