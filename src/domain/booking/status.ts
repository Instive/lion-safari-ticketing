import { eq } from "drizzle-orm";

import type { Tx } from "@/db";
import { bookings, type Booking, type BookingStatus } from "@/db/schema";
import { writeAudit, writeChange, type Actor } from "../audit";
import { InvalidTransitionError, NotFoundError } from "../errors";

/**
 * The complete set of legal booking transitions (spec §16). There is no generic
 * "set status" path anywhere in the system — every change goes through here, is
 * checked against this table, and is audited.
 */
const ALLOWED: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["PAID", "FAILED", "CANCELLED"],
  PAID: ["REFUND_PENDING", "CANCELLED"],
  CASH_CONFIRMED: ["REFUND_PENDING", "CANCELLED"],
  REFUND_PENDING: ["REFUNDED", "PAID"], // PAID = provider rejected the refund
  REFUNDED: [],
  FAILED: [],
  CANCELLED: [],
  // A blank in a counter's ticket book is either sold — which is a staff cash
  // confirmation, the same authority as any other counter sale — or it expires
  // unsold at day rollover. It can never become PAID: nothing about a ticket
  // book involves the payment gateway.
  RESERVED: ["CASH_CONFIRMED", "CANCELLED"],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** A booking in one of these states has been paid for and deserves a ticket. */
export function isConfirmed(status: BookingStatus): boolean {
  return status === "PAID" || status === "CASH_CONFIRMED";
}

/**
 * Locks the booking row, verifies the transition is legal, applies it, and
 * writes the audit + sync-feed entries — all inside the caller's transaction.
 *
 * Returns `null` when the booking is already in the target state, which makes
 * retried webhooks and double-clicks harmless no-ops rather than errors.
 */
export async function transitionBooking(
  tx: Tx,
  bookingId: string,
  to: BookingStatus,
  actor: Actor,
  context?: Record<string, unknown>,
): Promise<Booking | null> {
  const [current] = await tx
    .select()
    .from(bookings)
    .where(eq(bookings.id, bookingId))
    .for("update")
    .limit(1);

  if (!current) throw new NotFoundError(`booking ${bookingId}`);
  if (current.status === to) return null;

  if (!canTransition(current.status, to)) {
    throw new InvalidTransitionError("booking", current.status, to);
  }

  const [updated] = await tx
    .update(bookings)
    .set({ status: to, updatedAt: new Date() })
    .where(eq(bookings.id, bookingId))
    .returning();

  await writeAudit(tx, {
    actor,
    action: `booking.${to.toLowerCase()}`,
    entity: "booking",
    entityId: bookingId,
    before: { status: current.status },
    after: { status: to },
    context,
  });

  await writeChange(tx, {
    entity: "booking",
    entityId: bookingId,
    operation: "UPDATE",
    payload: { status: to },
  });

  return updated!;
}
