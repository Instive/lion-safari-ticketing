import { eq } from "drizzle-orm";

import { db, type Tx } from "@/db";
import { bookings, type Booking, type CounterTender, type Ticket } from "@/db/schema";
import { generateBookingCode } from "@/lib/codes";
import { businessDate } from "@/lib/time";
import { writeAudit, writeChange, type Actor } from "../audit";
import { issueTicketFor } from "../ticket/issue";
import { quoteFor, resolveRate, type RateSelection } from "./pricing";

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
  /**
   * Which fare to charge. Omitted means the standard one. Whatever this says,
   * the price itself is resolved server-side inside the transaction below —
   * a caller can name a rate, never an amount.
   */
  rate?: RateSelection;
  /**
   * How a counter sale was paid for. Ignored on the online channel, which is
   * confirmed by a verified webhook rather than by a person.
   */
  tender?: CounterTender;
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
 * ticket in the same transaction: the staff member has the money in hand, so
 * booking and ticket must either both exist or neither does.
 *
 * `tender` records whether that money was cash or a UPI transfer. It changes
 * nothing about how the booking is confirmed — a staff member vouching for a
 * UPI transfer is exactly as unverified as one vouching for notes in a drawer,
 * and the app cannot see either. It exists so the day's takings can be
 * reconciled against the drawer and the bank statement separately.
 */
export async function createCounterBooking(
  input: Omit<CreateBookingInput, "channel">,
): Promise<CreateBookingResult> {
  return createBooking({ ...input, channel: "COUNTER" });
}

async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const visitDate = input.visitDate ?? businessDate();
  const confirmedAtCreation = input.channel === "COUNTER";

  return db.transaction(async (tx) => {
    // Priced inside the transaction so a category read and the row that records
    // its price cannot straddle an edit to that category.
    const rate = await resolveRate(input.rate, input.channel, tx);
    const quote = quoteFor(input.visitorCount, input.channel, rate);

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
      perVisitorPaise: quote.perVisitorPaise,
      rateCategoryId: rate.categoryId,
      rateNote: rate.note,
      customerName: input.customerName ?? null,
      customerPhone: input.customerPhone ?? null,
      customerEmail: input.customerEmail ?? null,
      visitDate,
      counterTender: input.channel === "COUNTER" ? (input.tender ?? "CASH") : null,
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
        // A sale below the standard fare is the thing an audit is FOR: who
        // authorised it, at what price, and on what grounds.
        rate: rate.label,
        perVisitorPaise: booking.perVisitorPaise,
        concessional: rate.concessional,
        rateNote: rate.note,
        tender: booking.counterTender,
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
