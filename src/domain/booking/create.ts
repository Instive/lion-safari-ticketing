import { eq } from "drizzle-orm";

import { db, type Tx } from "@/db";
import { bookings, type Booking, type Ticket } from "@/db/schema";
import { generateBookingCode } from "@/lib/codes";
import { businessDate } from "@/lib/time";
import { writeAudit, writeChange, type Actor } from "../audit";
import { issueTicketFor } from "../ticket/issue";
import { quoteFor } from "./pricing";

export type CreateBookingInput = {
  channel: "ONLINE" | "COUNTER";
  visitorCount: number;
  /** Defaults to today in the park's timezone. Server-decided, never client-decided. */
  visitDate?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  /**
   * Caller-supplied key that makes retries safe. The web form sends a key minted
   * when the form was rendered; the counter app sends one per cash sale.
   */
  idempotencyKey: string;
  createdByStaffId?: string | null;
  deviceId?: string | null;
  actor: Actor;
};

export type CreateBookingResult = {
  booking: Booking;
  ticket: Ticket | null;
  /** False when an earlier identical request already created this booking. */
  created: boolean;
};

/**
 * Creates an ONLINE booking in PENDING — no ticket yet, because no money has
 * been verified. The ticket is issued only when the payment webhook clears.
 */
export async function createOnlineBooking(
  input: Omit<CreateBookingInput, "channel">,
): Promise<CreateBookingResult> {
  return createBooking({ ...input, channel: "ONLINE" });
}

/**
 * Creates a COUNTER booking that is already CASH_CONFIRMED and issues its
 * ticket in the same transaction: the staff member has the cash in hand, so
 * booking and ticket must either both exist or neither does.
 */
export async function createCounterBooking(
  input: Omit<CreateBookingInput, "channel">,
): Promise<CreateBookingResult> {
  return createBooking({ ...input, channel: "COUNTER" });
}

async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const quote = quoteFor(input.visitorCount, input.channel);
  const visitDate = input.visitDate ?? businessDate();
  const confirmedAtCreation = input.channel === "COUNTER";

  return db.transaction(async (tx) => {
    const existing = await findByIdempotencyKey(tx, input.idempotencyKey);
    if (existing) {
      // A retry of a request we already served. Return the original booking and
      // its ticket; never create a second one.
      const ticket = confirmedAtCreation
        ? (await issueTicketFor(tx, existing, input.actor)).ticket
        : null;
      return { booking: existing, ticket, created: false };
    }

    const booking = await insertWithUniqueCode(tx, {
      channel: input.channel,
      status: confirmedAtCreation ? "CASH_CONFIRMED" : "PENDING",
      visitorCount: quote.visitorCount,
      amountTotal: quote.amountTotalPaise,
      convenienceFee: quote.convenienceFeePaise,
      currency: quote.currency,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
      customerEmail: input.customerEmail ?? null,
      visitDate,
      createdByStaffId: input.createdByStaffId ?? null,
      deviceId: input.deviceId ?? null,
      idempotencyKey: input.idempotencyKey,
    });

    if (!booking) {
      // Lost a race against a concurrent identical submit — the winner's row is
      // now visible, so fall back to it.
      const winner = await findByIdempotencyKey(tx, input.idempotencyKey);
      const ticket =
        winner && confirmedAtCreation
          ? (await issueTicketFor(tx, winner, input.actor)).ticket
          : null;
      return { booking: winner!, ticket, created: false };
    }

    await writeAudit(tx, {
      actor: input.actor,
      action: "booking.created",
      entity: "booking",
      entityId: booking.id,
      after: {
        channel: booking.channel,
        status: booking.status,
        visitorCount: booking.visitorCount,
        amountTotal: booking.amountTotal,
        visitDate: booking.visitDate,
      },
    });

    await writeChange(tx, {
      entity: "booking",
      entityId: booking.id,
      operation: "INSERT",
      payload: { status: booking.status },
    });

    const ticket = confirmedAtCreation
      ? (await issueTicketFor(tx, booking, input.actor)).ticket
      : null;

    return { booking, ticket, created: true };
  });
}

async function findByIdempotencyKey(tx: Tx, key: string): Promise<Booking | undefined> {
  const [row] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.idempotencyKey, key))
    .limit(1);
  return row;
}

/**
 * Booking codes are random and short, so a collision is unlikely but possible.
 * The UNIQUE constraint catches it and we simply draw again.
 */
async function insertWithUniqueCode(
  tx: Tx,
  values: Omit<typeof bookings.$inferInsert, "bookingCode">,
): Promise<Booking | undefined> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await tx
      .insert(bookings)
      .values({ ...values, bookingCode: generateBookingCode() })
      .onConflictDoNothing()
      .returning();

    if (row) return row;

    // Either the booking code or the idempotency key collided. If it was the
    // idempotency key, the caller handles it; check that first.
    const existing = await findByIdempotencyKey(tx, values.idempotencyKey);
    if (existing) return undefined;
  }
  return undefined;
}
