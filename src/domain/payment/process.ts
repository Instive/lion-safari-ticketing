import { eq } from "drizzle-orm";

import { db, type Tx } from "@/db";
import { bookings, paymentEvents, payments, type Booking } from "@/db/schema";
import { writeAudit } from "../audit";
import { transitionBooking } from "../booking/status";
import { deactivateTicketForBooking, issueTicketFor } from "../ticket/issue";
import type { NormalizedPaymentEvent } from "./provider";

export type ProcessResult =
  | { status: "PROCESSED"; bookingId: string; ticketId: string | null; bookingCode: string }
  | { status: "DUPLICATE" }
  | { status: "UNKNOWN_ORDER" }
  | { status: "MISMATCH"; detail: string }
  | { status: "IGNORED"; detail: string };

/**
 * Turns a verified provider event into authoritative state.
 *
 * This is the only path by which an online booking can become PAID. Guarantees:
 *  - Exactly-once: `payment_events.provider_event_id` is UNIQUE, so a replayed
 *    webhook short-circuits as DUPLICATE before touching anything.
 *  - Amount-checked: the provider's amount and currency must match what we
 *    recorded when the order was created. We never trust the payload's own idea
 *    of what was owed (spec §4.3).
 *  - Atomic: event log, payment row, booking status and ticket all commit
 *    together, or none of them do.
 *
 * The caller must have already verified the signature.
 */
export async function processPaymentEvent(
  provider: string,
  event: NormalizedPaymentEvent,
): Promise<ProcessResult> {
  return db.transaction(async (tx) => {
    // 1. Claim the event. A retry loses the race against the unique index and
    //    exits here without re-applying anything.
    const [claimed] = await tx
      .insert(paymentEvents)
      .values({
        provider,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
        signatureValid: true,
        rawPayload: event.rawPayload as object,
      })
      .onConflictDoNothing({ target: paymentEvents.providerEventId })
      .returning();

    if (!claimed) return { status: "DUPLICATE" };

    // 2. Find the order we created. Unknown order ids are logged, not trusted.
    const [payment] = await tx
      .select()
      .from(payments)
      .where(eq(payments.providerOrderId, event.orderId))
      .limit(1);

    if (!payment) {
      await markEvent(tx, claimed.id, "no matching order for this event");
      return { status: "UNKNOWN_ORDER" };
    }

    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, payment.bookingId))
      .for("update")
      .limit(1);

    if (!booking) {
      await markEvent(tx, claimed.id, "order references a missing booking");
      return { status: "UNKNOWN_ORDER" };
    }

    await tx
      .update(paymentEvents)
      .set({ paymentId: payment.id, bookingId: booking.id })
      .where(eq(paymentEvents.id, claimed.id));

    switch (event.kind) {
      case "PAYMENT_SUCCESS":
        return handleSuccess(tx, claimed.id, event, booking, payment.id);
      case "PAYMENT_FAILED":
        return handleFailure(tx, claimed.id, event, booking, payment.id);
      case "REFUND_SUCCESS":
        return handleRefund(tx, claimed.id, booking, payment.id);
      default:
        await markEvent(tx, claimed.id, `unhandled event type ${event.eventType}`);
        return { status: "IGNORED", detail: event.eventType };
    }
  });
}

async function handleSuccess(
  tx: Tx,
  eventRowId: string,
  event: NormalizedPaymentEvent,
  booking: Booking,
  paymentId: string,
): Promise<ProcessResult> {
  // The amount is checked against OUR record of what this booking costs.
  if (event.amountPaise == null) {
    await markEvent(tx, eventRowId, "success event carried no amount");
    return { status: "MISMATCH", detail: "missing amount" };
  }
  if (event.amountPaise !== booking.amountTotal) {
    const detail = `expected ${booking.amountTotal} paise, provider reported ${event.amountPaise}`;
    await markEvent(tx, eventRowId, detail);
    await writeAudit(tx, {
      actor: { type: "WEBHOOK" },
      action: "payment.amount_mismatch",
      entity: "booking",
      entityId: booking.id,
      context: { detail, orderId: event.orderId },
    });
    // Deliberately does NOT confirm the booking. Admin reconciliation picks it up.
    return { status: "MISMATCH", detail };
  }
  if (event.currency && event.currency !== booking.currency) {
    const detail = `currency mismatch: expected ${booking.currency}, got ${event.currency}`;
    await markEvent(tx, eventRowId, detail);
    return { status: "MISMATCH", detail };
  }

  await tx
    .update(payments)
    .set({
      status: "SUCCESS",
      providerPaymentId: event.providerPaymentId,
      rawPayload: event.rawPayload as object,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId));

  // Returns null when the booking was already PAID — a harmless re-delivery.
  await transitionBooking(
    tx,
    booking.id,
    "PAID",
    { type: "WEBHOOK" },
    { orderId: event.orderId, providerPaymentId: event.providerPaymentId },
  );

  const paidBooking: Booking = { ...booking, status: "PAID" };
  const { ticket } = await issueTicketFor(tx, paidBooking, { type: "WEBHOOK" });

  await markEvent(tx, eventRowId, null);

  return {
    status: "PROCESSED",
    bookingId: booking.id,
    ticketId: ticket.id,
    bookingCode: booking.bookingCode,
  };
}

async function handleFailure(
  tx: Tx,
  eventRowId: string,
  event: NormalizedPaymentEvent,
  booking: Booking,
  paymentId: string,
): Promise<ProcessResult> {
  await tx
    .update(payments)
    .set({
      status: "FAILED",
      providerPaymentId: event.providerPaymentId,
      rawPayload: event.rawPayload as object,
      updatedAt: new Date(),
    })
    .where(eq(payments.id, paymentId));

  // A failure only matters while we are still waiting; it must never undo a
  // booking that has already been paid for.
  if (booking.status === "PENDING") {
    await transitionBooking(tx, booking.id, "FAILED", { type: "WEBHOOK" }, { orderId: event.orderId });
  }

  await markEvent(tx, eventRowId, null);
  return {
    status: "PROCESSED",
    bookingId: booking.id,
    ticketId: null,
    bookingCode: booking.bookingCode,
  };
}

async function handleRefund(
  tx: Tx,
  eventRowId: string,
  booking: Booking,
  paymentId: string,
): Promise<ProcessResult> {
  await tx
    .update(payments)
    .set({ status: "REFUNDED", updatedAt: new Date() })
    .where(eq(payments.id, paymentId));

  if (booking.status === "REFUND_PENDING" || booking.status === "PAID") {
    if (booking.status === "PAID") {
      await transitionBooking(tx, booking.id, "REFUND_PENDING", { type: "WEBHOOK" });
    }
    await transitionBooking(tx, booking.id, "REFUNDED", { type: "WEBHOOK" });
    await deactivateTicketForBooking(tx, booking.id, "CANCELLED", { type: "WEBHOOK" });
  }

  await markEvent(tx, eventRowId, null);
  return {
    status: "PROCESSED",
    bookingId: booking.id,
    ticketId: null,
    bookingCode: booking.bookingCode,
  };
}

async function markEvent(tx: Tx, eventRowId: string, error: string | null): Promise<void> {
  await tx
    .update(paymentEvents)
    .set({ processedAt: new Date(), processingError: error })
    .where(eq(paymentEvents.id, eventRowId));
}
