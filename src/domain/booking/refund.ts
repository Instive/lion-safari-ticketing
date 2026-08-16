import { eq } from "drizzle-orm";

import { db } from "@/db";
import { bookings, payments } from "@/db/schema";
import { writeAudit, type Actor } from "../audit";
import { DomainError } from "../errors";
import { getPaymentProvider } from "../payment";
import { deactivateTicketForBooking } from "../ticket/issue";
import { transitionBooking } from "./status";

/**
 * Cancels a booking and voids its ticket.
 *
 * Used for cash bookings (money is returned at the counter) and for bookings
 * that were never paid. Online refunds go through `refundOnlineBooking` so the
 * money movement is handled by the gateway.
 */
export async function cancelBooking(
  bookingId: string,
  actor: Actor,
  reason: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(bookings)
      .where(eq(bookings.id, bookingId))
      .for("update")
      .limit(1);

    if (!booking) throw new DomainError("NOT_FOUND", "We could not find that booking.");

    await transitionBooking(tx, bookingId, "CANCELLED", actor, { reason });
    await deactivateTicketForBooking(tx, bookingId, "CANCELLED", actor);

    await writeAudit(tx, {
      actor,
      action: "booking.cancelled",
      entity: "booking",
      entityId: bookingId,
      context: { reason, channel: booking.channel },
    });
  });
}

/**
 * Starts a gateway refund for a paid online booking.
 *
 * The ticket is voided and the booking moves to REFUND_PENDING immediately, so
 * it can no longer board. The booking only reaches REFUNDED when the provider's
 * refund webhook confirms the money actually moved — we never mark a refund
 * complete on the strength of an API call alone.
 */
export async function refundOnlineBooking(
  bookingId: string,
  actor: Actor,
  reason: string,
): Promise<void> {
  const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  if (!booking) throw new DomainError("NOT_FOUND", "We could not find that booking.");

  if (booking.status !== "PAID") {
    throw new DomainError(
      "NOT_REFUNDABLE",
      "Only a paid booking can be refunded.",
      `status=${booking.status}`,
    );
  }

  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.bookingId, bookingId))
    .limit(1);

  if (!payment?.providerPaymentId) {
    throw new DomainError(
      "NO_PAYMENT_RECORD",
      "This booking has no completed payment to refund.",
    );
  }

  // Void the ticket first: a guest must not be able to board while a refund is
  // in flight.
  await db.transaction(async (tx) => {
    await transitionBooking(tx, bookingId, "REFUND_PENDING", actor, { reason });
    await deactivateTicketForBooking(tx, bookingId, "CANCELLED", actor);
  });

  const provider = getPaymentProvider(payment.provider);
  // Deterministic refund id: a retried refund cannot become two refunds.
  const refundId = `RF-${booking.bookingCode}`;

  try {
    const result = await provider.refund({
      orderId: payment.providerOrderId,
      providerPaymentId: payment.providerPaymentId,
      amountPaise: booking.amountTotal,
      refundId,
    });

    await db
      .update(payments)
      .set({ status: "REFUND_PENDING", updatedAt: new Date() })
      .where(eq(payments.id, payment.id));

    await writeAudit(db, {
      actor,
      action: "payment.refund_requested",
      entity: "booking",
      entityId: bookingId,
      context: { reason, refundId, providerRefundId: result.providerRefundId, state: result.state },
    });
  } catch (err) {
    // The booking stays REFUND_PENDING with the ticket voided — safe — and the
    // failure is recorded for an operator to retry.
    await writeAudit(db, {
      actor,
      action: "payment.refund_failed",
      entity: "booking",
      entityId: bookingId,
      context: { reason, refundId, error: err instanceof Error ? err.message : String(err) },
    });
    throw new DomainError(
      "REFUND_FAILED",
      "The refund could not be sent to the payment provider. The ticket has been cancelled; please retry the refund.",
      err,
    );
  }
}
